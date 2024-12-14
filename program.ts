import puppeteer from 'puppeteer';
import { OpenAI } from 'openai';
import { createObjectCsvWriter } from 'csv-writer';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface ProductData {
    url: string;
    name: string;
    price: string;
    description: string;
    brand: string;
    images: string[];
    isProductPage: boolean;
    error?: string;
}
async function isProductPage(content: string): Promise<boolean> {
//     const completion = await openai.chat.completions.create({
//         messages: [
//             {
//                 role: "system",
//                 content: `You are an expert e-commerce analyst. Analyze the provided HTML content and determine if this is a product page.

// Key indicators of a product page:
// 1. Contains specific product pricing information
// 2. Has detailed product description/specifications
// 3. Contains "Add to Cart", "Buy Now", or similar purchase buttons
// 4. Shows product-specific images
// 5. Often has product SKU/ID numbers
// 6. Usually includes product title/name prominently displayed

// Non-product pages typically are:
// - Category/listing pages (multiple products)
// - Home pages
// - News articles
// - Blog posts
// - Contact pages

// Respond with a JSON object containing:
// {
//     "isProduct": boolean,
//     "confidence": number (0-1),
//     "pageType": string,
//     "reasoning": string
// }`
//             },
//             {
//                 role: "user",
//                 content: content.substring(0, 8000) // Increased content length for better context
//             }
//         ],
//         model: "gpt-4o",
//         response_format: { type: "json_object" },
//     });

//     const analysis = JSON.parse(completion.choices[0].message.content);
//     console.log("Page Analysis:", analysis);
//     return analysis.isProduct && analysis.confidence > 0.7;
    return true
}

async function extractProductData(url: string, content: string, images: string[]): Promise<ProductData> {
    // First get product details with improved prompt
    const productCompletion = await openai.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `You are an expert e-commerce data analyst. Extract precise product information from the HTML content.

Focus on these specific elements:
1. Name: The main product title/name only
2. Price: The current selling price (not MSRP/crossed-out prices). Include currency.
3. Description: A clear, concise product description. Exclude marketing fluff.
4. Brand: The manufacturer/brand name only

Return a JSON object with these exact fields: name, price (as string), description, brand.

Important rules:
- Be precise and accurate
- Don't make assumptions
- If a field can't be found, use an empty string
- Don't include related products information
- For price, prefer the actual selling price over MSRP/RRP`
            },
            {
                role: "user",
                content: `URL: ${url}\n\nContent: ${content.substring(0, 8000)}`
            }
        ],
        model: "gpt-4o",
        response_format: { type: "json_object" },
    });

    const productInfo = JSON.parse(productCompletion.choices[0].message.content || "{}");

    // Then filter images with improved prompt
    const imageCompletion = await openai.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `You are analyzing product images for an e-commerce site. 
                
Product details:
Name: ${productInfo.name}
Description: ${productInfo.description}
Brand: ${productInfo.brand}

Analyze the provided image URLs and return only those that show the main product. 

Rules for image selection:
1. Include: 
   - Main product shots
   - Different angles of the same product
   - Product detail shots
   
2. Exclude:
   - Thumbnails (usually containing 'thumb' or small dimensions)
   - Related products
   - Advertisement banners
   - Navigation icons/logos
   - Size charts
   - Lifestyle/context shots not showing the product clearly

Return a JSON object with:
{
    "relevantImages": string[],
    "reasoning": string
}`
            },
            {
                role: "user",
                content: JSON.stringify({
                    url: url,
                    availableImages: images
                })
            }
        ],
        model: "gpt-4o",
        response_format: { type: "json_object" },
    });

    const imageAnalysis = JSON.parse(imageCompletion.choices[0].message.content || "{ \"relevantImages\": [] }");
    console.log("Image Analysis:", imageAnalysis.reasoning);

    return {
        url,
        ...productInfo,
        images: imageAnalysis.relevantImages,
        isProductPage: true
    };
}

async function scrapeProduct(url: string): Promise<ProductData> {
    try {
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000});

        // Get page content
        const content = await page.content();

        // Check if it's a product page
        const productPageCheck = await isProductPage(content);
        if (!productPageCheck) {
            await browser.close();
            return {
                url,
                name: '',
                price: '',
                description: '',
                brand: '',
                images: [],
                isProductPage: false,
                error: 'Not a product page'
            };
        }

        // Get all images
        const images = await page.evaluate(() => {
            const imgElements = document.querySelectorAll('img');
            return Array.from(imgElements)
                .map(img => img.src)
                .filter(src => src && src.length > 0);
        });

        const productData = await extractProductData(url, content, images);
        await browser.close();
        return productData;

    } catch (error) {
        return {
            url,
            name: '',
            price: '',
            description: '',
            brand: '',
            images: [],
            isProductPage: false,
            error: `Error: ${error.message}`
        };
    }
}

async function main() {
    // Example usage
    const urls = [
        'https://books.apple.com/us/book/the-backyard-bird-chronicles/id6452501953', // a book; note that there are plenty of similar books on the images
        "https://au.shein.com/100pcs-Striped-Pattern-Straw-Kitchen-Christmas-Gift-p-17756189.html", // try scraping from shein
        "https://www.uniqlo.com/au/en/products/E453151-000?colorCode=COL11&sizeCode=SMA001", // see if it only scrapes the pink one
        "https://www.tumi.com.au/tumi/tegra-lite%C2%AE/international-exp-carry-on/tu-144791-4482.html",
        "https://www.cartier.com.au/en-au/collections/jewellery/collections/grain-de-caf%C3%A9/b8301524-grain-de-caf%C3%A9-earrings.html",
        "https://www.abc.net.au/news" // not a product page
    ];

    const csvWriter = createObjectCsvWriter({
        path: 'products.csv',
        header: [
            { id: 'url', title: 'URL' },
            { id: 'name', title: 'Name' },
            { id: 'price', title: 'Price' },
            { id: 'description', title: 'Description' },
            { id: 'brand', title: 'Brand' },
            { id: 'images', title: 'Images' },
            { id: 'isProductPage', title: 'Is Product Page' },
            { id: 'error', title: 'Error' }
        ]
    });

    const results: ProductData[] = [];
    for (const url of urls) {
        const productData = await scrapeProduct(url);
        results.push(productData);
    }

    await csvWriter.writeRecords(results);
    console.log('Scraping completed! Check products.csv for results.');
}

main().then(() => process.exit(0)).catch(console.error);
