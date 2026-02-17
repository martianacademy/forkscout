/**
 * Web tools — search, browse, and screenshot using SearXNG + Playwright.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { getConfig } from '../config';

export const webSearch = tool({
    description: 'Search the web for information. Uses SearXNG if available, otherwise falls back to scraping a search engine with Chromium.',
    inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().describe('Number of results').optional(),
    }),
    execute: async ({ query, limit }) => {
        const maxResults = limit || 5;
        const searxngUrl = getConfig().searxng.url;

        // Try SearXNG first
        try {
            const response = await fetch(
                `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`,
                { signal: AbortSignal.timeout(15000) },
            );
            if (response.ok) {
                const data: any = await response.json();
                const results = data.results?.slice(0, maxResults) || [];
                if (results.length > 0) {
                    console.log(`    ✅ SearXNG: ${results.length} result(s) for "${query}"`);
                    return results.map((r: any) => ({
                        title: r.title,
                        url: r.url,
                        snippet: r.content,
                    }));
                }
            }
        } catch { /* SearXNG unavailable */ }

        // Fallback: Chromium scraping
        console.log('    ⚡ SearXNG unavailable, falling back to Chromium...');
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();

            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
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

            return results.length > 0 ? results : [{ title: 'No results', url: '', snippet: `No results found for "${query}"` }];
        } finally {
            await browser.close();
        }
    },
});

export const browseWeb = tool({
    description: 'Browse a webpage and extract its text content. Use this to read articles, documentation, or any web page.',
    inputSchema: z.object({
        url: z.string().describe('URL to browse'),
        selector: z.string().describe('Optional CSS selector to extract specific content').optional(),
    }),
    execute: async ({ url, selector }) => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            let content: string;
            if (selector) {
                content = await page.evaluate((sel: string) => {
                    const el = document.querySelector(sel);
                    return el?.textContent?.trim() || 'Element not found';
                }, selector);
            } else {
                content = await page.evaluate(() => {
                    const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'iframe', '.ads', '#cookie-banner'];
                    for (const sel of removeSelectors) {
                        document.querySelectorAll(sel).forEach(el => el.remove());
                    }
                    const main = document.querySelector('main, article, [role="main"]');
                    return (main || document.body)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 8000) || '';
                });
            }

            return content;
        } finally {
            await browser.close();
        }
    },
});

export const browserScreenshot = tool({
    description: 'Take a screenshot of a webpage',
    inputSchema: z.object({
        url: z.string().describe('URL to screenshot'),
        outputPath: z.string().describe('Output file path'),
        viewport: z.object({ width: z.number(), height: z.number() }).describe('Viewport size').optional(),
    }),
    execute: async ({ url, outputPath, viewport }) => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 720 } });
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.screenshot({ path: outputPath });
            return `Screenshot saved to ${outputPath}`;
        } finally {
            await browser.close();
        }
    },
});
