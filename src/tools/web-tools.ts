/**
 * Web tools — search, browse, and screenshot using SearXNG + Playwright.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { getConfig } from '../config';
import { withAccess } from './access';

// ── Reusable Browser Pool ──────────────────────────────

let _browser: any = null;
let _browserCloseTimer: ReturnType<typeof setTimeout> | null = null;
const BROWSER_IDLE_MS = 60_000; // fallback — prefer getConfig().agent.browserIdleMs

/** Get a shared Chromium browser instance (lazy-launched, auto-closed after idle) */
async function getBrowser(): Promise<any> {
    if (_browserCloseTimer) {
        clearTimeout(_browserCloseTimer);
        _browserCloseTimer = null;
    }

    if (!_browser || !_browser.isConnected()) {
        const { chromium } = await import('playwright');
        _browser = await chromium.launch({ headless: true });
        _browser.on('disconnected', () => { _browser = null; });
    }

    // Schedule auto-close after idle period
    _browserCloseTimer = setTimeout(async () => {
        if (_browser) {
            try { await _browser.close(); } catch { /* already closed */ }
            _browser = null;
        }
        _browserCloseTimer = null;
    }, getConfig().agent.browserIdleMs ?? BROWSER_IDLE_MS);

    return _browser;
}

/** Create a fresh page in the shared browser. Caller must close the page when done. */
async function createPage(viewport?: { width: number; height: number }): Promise<any> {
    const browser = await getBrowser();
    const context = await browser.newContext(viewport ? { viewport } : {});
    return context.newPage();
}

export const webSearch = withAccess('guest', tool({
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
        } catch (err) {
            console.warn(`[WebSearch]: SearXNG unavailable (${err instanceof Error ? err.message : err}), falling back to Chromium`);
        }

        // Fallback: Chromium scraping
        console.log('    ⚡ SearXNG unavailable, falling back to Chromium...');
        const page = await createPage();
        try {
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
            await page.context().close();
        }
    },
}));


