// src/tools/scrape_page_tools.ts
//
// Lightweight web scraper — pure fetch + HTML parsing (no browser/Playwright).
// Use this FIRST before reaching for web_browser_tools; it's 100x faster
// and works for any static or server-rendered page.
//
// Actions:
//   text      — extract clean readable text (scripts/styles removed)
//   selector  — CSS selector → array of matching elements
//   links     — all anchor tags with href and text
//   meta      — page title + meta tags (description, og:*, twitter:*, etc.)
//   table     — first matching table → array of row objects (headers as keys)
//
// Falls back to web_browser_tools when JS-rendered content is required.

import { tool } from "ai";
import { z } from "zod";
import { parse, type HTMLElement } from "node-html-parser";

export const IS_BOOTSTRAP_TOOL = false;

const DEFAULT_UA =
    "Mozilla/5.0 (compatible; ForkScout/3.0; +https://github.com/marsnext/forkscout)";

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": DEFAULT_UA,
                Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            },
            redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

function cleanText(root: HTMLElement): string {
    // Remove script, style, nav, footer noise
    ["script", "style", "noscript", "nav", "footer", "aside", "iframe"].forEach((tag) => {
        root.querySelectorAll(tag).forEach((el) => el.remove());
    });
    return root.text
        .replace(/\s{3,}/g, "\n\n")  // collapse excessive whitespace
        .trim()
        .slice(0, 12_000);            // 12k chars is plenty
}

export const scrape_page_tools = tool({
    description:
        "Lightweight web scraper — no browser, uses plain fetch + HTML parsing. " +
        "Fast and efficient for static pages, news articles, docs, GitHub, Wikipedia, etc. " +
        "Actions: 'text' (clean page text), 'selector' (CSS selector → elements), " +
        "'links' (all hrefs), 'meta' (title/og/twitter tags), 'table' (first table as JSON rows). " +
        "Use web_browser_tools instead when the page requires JavaScript to render.",
    inputSchema: z.object({
        action: z
            .enum(["text", "selector", "links", "meta", "table"])
            .describe("What to extract from the page"),
        url: z.string().url().describe("Full URL of the page to scrape"),
        selector: z
            .string()
            .optional()
            .describe("CSS selector for the 'selector' action (e.g. 'h2', 'article p', '.price')"),
        timeout_seconds: z
            .number()
            .int()
            .min(1)
            .max(30)
            .default(10)
            .describe("HTTP fetch timeout in seconds (default 10)"),
    }),
    execute: async (input) => {
        const timeoutMs = (input.timeout_seconds ?? 10) * 1_000;

        let html: string;
        try {
            html = await fetchHtml(input.url, timeoutMs);
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }

        const root = parse(html, { comment: false });

        try {
            switch (input.action) {
                // ── text ────────────────────────────────────────────────────
                case "text": {
                    return { success: true, text: cleanText(root) };
                }

                // ── selector ─────────────────────────────────────────────────
                case "selector": {
                    if (!input.selector) {
                        return { success: false, error: "'selector' field is required for this action" };
                    }
                    const elements = root.querySelectorAll(input.selector).slice(0, 50);
                    const matches = elements.map((el) => ({
                        text: el.text.trim().slice(0, 500),
                        html: el.outerHTML.slice(0, 500),
                        href: el.getAttribute("href") ?? el.querySelector("a")?.getAttribute("href"),
                    }));
                    return { success: true, count: matches.length, matches };
                }

                // ── links ────────────────────────────────────────────────────
                case "links": {
                    const anchors = root.querySelectorAll("a[href]").slice(0, 200);
                    const links = anchors
                        .map((a) => ({
                            text: a.text.trim().slice(0, 200),
                            href: a.getAttribute("href") ?? "",
                        }))
                        .filter((l) => l.href && !l.href.startsWith("#"));
                    return { success: true, count: links.length, links };
                }

                // ── meta ─────────────────────────────────────────────────────
                case "meta": {
                    const metaTags = root.querySelectorAll("meta");
                    const meta: Record<string, string> = {};

                    const title = root.querySelector("title")?.text.trim();
                    if (title) meta["title"] = title;

                    for (const tag of metaTags) {
                        const name =
                            tag.getAttribute("name") ??
                            tag.getAttribute("property") ??
                            tag.getAttribute("itemprop");
                        const content = tag.getAttribute("content");
                        if (name && content) meta[name] = content.trim().slice(0, 300);
                    }
                    return { success: true, meta };
                }

                // ── table ────────────────────────────────────────────────────
                case "table": {
                    const tableSel = input.selector ?? "table";
                    const table = root.querySelector(tableSel);
                    if (!table) {
                        return { success: false, error: `No table found matching '${tableSel}'` };
                    }

                    const headerEls = table.querySelectorAll("th");
                    const headers = headerEls.length
                        ? headerEls.map((th) => th.text.trim())
                        : [];

                    const bodyRows = table.querySelectorAll("tr").filter((r) =>
                        r.querySelectorAll("td").length > 0
                    );

                    const rows = bodyRows.slice(0, 100).map((row) => {
                        const cells = row.querySelectorAll("td").map((td) => td.text.trim());
                        if (headers.length) {
                            return Object.fromEntries(
                                headers.map((h, i) => [h || `col${i}`, cells[i] ?? ""])
                            );
                        }
                        return cells;
                    });

                    return { success: true, headers, row_count: rows.length, rows };
                }

                default:
                    return { success: false, error: `Unknown action: ${input.action}` };
            }
        } catch (err: any) {
            return { success: false, error: `Parse error: ${(err as Error).message}` };
        }
    },
});
