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
    // const completion = await openai.chat.completions.create({
    //     messages: [
    //         {
    //             role: "system",
    //             content: `You are an expert at analyzing HTML content to classify web pages. 
    //     A "product page" typically contains some of the following elements:
    //     - A product name
    //     - A price
    //     - A description or specifications
    //     - Product images
        
    //     If the HTML content represents a product page, respond with "true". 
    //     If it does not meet these criteria (e.g., it is a category page, home page, or another type of non-product page), respond with "false" and briefly explain what type of page it might be (e.g., "false: category page" or "false: home page"). 
        
    //     Your response should always include "true" or "false" at the start.`
    //         },
    //         {
    //             role: "user",
    //             content: content.substring(0, 4000) // Limiting content length
    //         }
    //     ],
    //     model: "gpt-4o-mini",
    // });
    // console.log("OpenAI Response:", JSON.stringify(completion, null, 2));
    // return completion.choices[0].message.content?.toLowerCase().includes('true') ?? false;
    return true;
}


async function extractProductData(url: string, content: string, images: string[]): Promise<ProductData> {
    // First get product details
    const productCompletion = await openai.chat.completions.create({
        messages: [
            {
                role: "system",
                content: "Extract product information from the HTML content. Return a JSON object with: name of the product, price (as string), description of the product, brand."
            },
            {
                role: "user",
                content: content.substring(0, 4000)
            }
        ],
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
    });

    const productInfo = JSON.parse(productCompletion.choices[0].message.content || "{}");

    // Then filter images
    const imageCompletion = await openai.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `You are analyzing images for a product. The product details are:
                Name: ${productInfo.name}
                Description: ${productInfo.description}
                Brand: ${productInfo.brand}
                
                I will provide you with image URLs. Return a JSON object with an 'relevantImages' array containing only URLs that appear to be of the main product (based on image URL patterns and context). Exclude thumbnails, related products, advertisements, logos, and navigation icons.`
            },
            {
                role: "user",
                content: JSON.stringify({ availableImages: images })
            }
        ],
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
    });

    const imageAnalysis = JSON.parse(imageCompletion.choices[0].message.content || "{ \"relevantImages\": [] }");

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
