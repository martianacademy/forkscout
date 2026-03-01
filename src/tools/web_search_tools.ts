// path — Web search tool with fallback to DuckDuckGo, returns helpful error if both fail

import { z } from "zod";
import { tool } from "ai";

// ============== SCHEMA ==============
export const WebSearchSchema = z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().optional().default(5).describe("Max results to return (capped at 10)"),
});

export type WebSearchParams = z.infer<typeof WebSearchSchema>;

// ============== TOOL DEFINITION ==============
export const web_search_tools = tool({
    description:
        "Search the web and return top results. Uses SearXNG when available (SEARXNG_URL env), falls back to DuckDuckGo. If both fail, returns a fallback recommendation to try web_browser_tools instead.",
    inputSchema: WebSearchSchema,
    execute: execute,
});

// ============== EXECUTE ==============
export async function execute(input: WebSearchParams): Promise<SearchResult> {
    const { query, maxResults = 5 } = input;
    const searxngUrl = process.env.SEARXNG_URL?.trim();
    const cappedMax = Math.min(maxResults, 10);
    const errors: string[] = [];

    // ---- Try SearXNG (primary) ----
    if (searxngUrl) {
        try {
            const results = await searchSearXNG(searxngUrl, query, cappedMax);
            if (results.length > 0) {
                return { success: true, engine: "searxng", results };
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`SearXNG: ${msg}`);
        }
    }

    // ---- Fallback: DuckDuckGo ----
    try {
        const results = await searchDuckDuckGo(query, cappedMax);
        if (results.length > 0) {
            return { success: true, engine: "duckduckgo", results };
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`DuckDuckGo: ${msg}`);
    }

    // ---- All failed: return helpful error with fallback recommendation ----
    return {
        success: false,
        engine: "none",
        results: [],
        error: errors.join("; "),
        fallback: "⚠️ Web search is unavailable. Try using web_browser_tools instead for manual browsing.",
    };
}

// ============== FETCHERS ==============
async function searchSearXNG(baseUrl: string, query: string, max: number): Promise<SearchResultItem[]> {
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&engines=duckduckgo&shorten=1&n=${max}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as SearXNGResponse;
    return (data.results || []).slice(0, max).map((r) => ({
        title: r.title || "No title",
        url: r.url || "",
        snippet: r.content || r.shorteninfourl || "",
    }));
}

async function searchDuckDuckGo(query: string, max: number): Promise<SearchResultItem[]> {
    // Use HTML scraping since DDG has no free API
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    return extractDDGResults(html).slice(0, max);
}

function extractDDGResults(html: string): SearchResultItem[] {
    const results: SearchResultItem[] = [];
    const regex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 10) {
        results.push({
            title: cleanHtml(match[2]),
            url: decodeURIComponent(match[1]),
            snippet: cleanHtml(match[3]),
        });
    }
    return results;
}

function cleanHtml(str: string): string {
    return str.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ============== TYPES ==============
export interface SearchResultItem {
    title: string;
    url: string;
    snippet: string;
}

export interface SearchResult {
    success: boolean;
    engine: string;
    results: SearchResultItem[];
    error?: string;
    fallback?: string;
}

interface SearXNGResponse {
    results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        shorteninfourl?: string;
    }>;
}
