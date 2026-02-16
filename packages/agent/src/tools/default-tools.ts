import { z } from 'zod';
import { resolveAgentPath } from '../paths';
import { getCurrentDateTool } from './get-current-date';
import { generatePresentationTool } from './presentation-tool';

/**
 * File System Tool
 */
export const readFileTool = {
    name: 'read_file',
    description: 'Read contents of a file',
    parameters: z.object({
        path: z.string().describe('File path to read (relative to project root or absolute)'),
    }),
    async execute(params: { path: string }): Promise<string> {
        const fs = await import('fs/promises');
        const absPath = resolveAgentPath(params.path);
        return await fs.readFile(absPath, 'utf-8');
    },
};

/**
 * Web Search Tool - tries SearXNG first, falls back to Chromium-based scraping
 */
export const webSearchTool = {
    name: 'web_search',
    description: 'Search the web for information. Uses SearXNG if available, otherwise falls back to scraping a search engine with Chromium.',
    parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().describe('Number of results').optional(),
    }),
    async execute(params: { query: string; limit?: number }): Promise<any> {
        const maxResults = params.limit || 5;
        const searxngUrl = process.env.SEARXNG_URL || 'http://localhost:8888';

        // Try SearXNG first
        try {
            const response = await fetch(
                `${searxngUrl}/search?q=${encodeURIComponent(params.query)}&format=json`,
                { signal: AbortSignal.timeout(5000) }
            );
            if (response.ok) {
                const data: any = await response.json();
                const results = data.results?.slice(0, maxResults) || [];
                if (results.length > 0) {
                    return results.map((r: any) => ({
                        title: r.title,
                        url: r.url,
                        snippet: r.content,
                    }));
                }
            }
        } catch {
            // SearXNG unavailable, fall through to Chromium fallback
        }

        // Fallback: use Chromium to scrape DuckDuckGo HTML
        console.log('    ⚡ SearXNG unavailable, falling back to Chromium...');
        try {
            const { chromium } = await import('playwright');
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();

            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const results = await page.evaluate((max: number) => {
                const items: Array<{ title: string; url: string; snippet: string }> = [];
                const links = document.querySelectorAll('.result');
                for (let i = 0; i < Math.min(links.length, max); i++) {
                    const el = links[i];
                    const titleEl = el.querySelector('.result__a');
                    const snippetEl = el.querySelector('.result__snippet');
                    const urlEl = el.querySelector('.result__url');
                    if (titleEl) {
                        items.push({
                            title: titleEl.textContent?.trim() || '',
                            url: (titleEl as HTMLAnchorElement).href || urlEl?.textContent?.trim() || '',
                            snippet: snippetEl?.textContent?.trim() || '',
                        });
                    }
                }
                return items;
            }, maxResults);

            await browser.close();
            return results.length > 0 ? results : [{ title: 'No results', url: '', snippet: `No results found for "${params.query}"` }];
        } catch (error) {
            throw new Error(`Web search failed: SearXNG unavailable and Chromium fallback failed - ${error instanceof Error ? error.message : String(error)}`);
        }
    },
};

/**
 * Browse Webpage Tool - fetch and extract text content from a URL using Chromium
 */
export const browseWebTool = {
    name: 'browse_web',
    description: 'Browse a webpage and extract its text content. Use this to read articles, documentation, or any web page.',
    parameters: z.object({
        url: z.string().describe('URL to browse'),
        selector: z.string().describe('Optional CSS selector to extract specific content').optional(),
    }),
    async execute(params: { url: string; selector?: string }): Promise<string> {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        let content: string;
        if (params.selector) {
            content = await page.evaluate((sel: string) => {
                const el = document.querySelector(sel);
                return el?.textContent?.trim() || 'Element not found';
            }, params.selector);
        } else {
            // Extract main content, stripping nav/footer/scripts
            content = await page.evaluate(() => {
                // Remove noise elements
                const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'iframe', '.ads', '#cookie-banner'];
                for (const sel of removeSelectors) {
                    document.querySelectorAll(sel).forEach(el => el.remove());
                }
                const main = document.querySelector('main, article, [role="main"]');
                return (main || document.body)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 8000) || '';
            });
        }

        await browser.close();
        return content;
    },
};

/**
 * Browser Screenshot Tool
 */
export const browserScreenshotTool = {
    name: 'browser_screenshot',
    description: 'Take a screenshot of a webpage',
    parameters: z.object({
        url: z.string().describe('URL to screenshot'),
        outputPath: z.string().describe('Output file path'),
        viewport: z.object({
            width: z.number(),
            height: z.number(),
        }).describe('Viewport size').optional(),
    }),
    async execute(params: {
        url: string;
        outputPath: string;
        viewport?: { width: number; height: number };
    }): Promise<string> {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({
            viewport: params.viewport || { width: 1280, height: 720 },
        });

        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.screenshot({ path: params.outputPath });
        await browser.close();

        return `Screenshot saved to ${params.outputPath}`;
    },
};

/**
 * Default tool collection
 */
export const defaultTools = [
    readFileTool,
    webSearchTool,
    browseWebTool,
    browserScreenshotTool,
    getCurrentDateTool,
    generatePresentationTool,
];
