import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = true;

/** SearXNG JSON result shape (partial) */
interface SearXNGResult {
    title: string;
    url: string;
    content?: string;
    engine?: string;
}

async function searchSearXNG(
    baseUrl: string,
    query: string,
    maxResults: number,
): Promise<{ title: string; url: string; snippet?: string }[]> {
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`SearXNG returned ${res.status}`);
    const data = (await res.json()) as { results?: SearXNGResult[] };
    return (data.results ?? [])
        .slice(0, maxResults)
        .map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function searchDuckDuckGo(
    query: string,
    maxResults: number,
): Promise<{ title: string; url: string }[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url);
    const data = (await res.json()) as { RelatedTopics?: { Text?: string; FirstURL?: string }[] };
    return (data.RelatedTopics ?? [])
        .filter((t) => t.Text && t.FirstURL)
        .slice(0, maxResults)
        .map((t) => ({ title: t.Text!, url: t.FirstURL! }));
}

export const web_search = tool({
    description:
        "Search the web and return top results. Uses SearXNG when available (SEARXNG_URL env), falls back to DuckDuckGo.",
    inputSchema: z.object({
        query: z.string().describe("Search query"),
        maxResults: z.number().optional().default(5).describe("Max results to return"),
    }),
    execute: async (input) => {
        const { query, maxResults = 5 } = input;
        const searxngUrl = process.env.SEARXNG_URL?.trim();
        try {
            const results = searxngUrl
                ? await searchSearXNG(searxngUrl, query, maxResults)
                : await searchDuckDuckGo(query, maxResults);
            return { success: true, engine: searxngUrl ? "searxng" : "duckduckgo", results };
        } catch (err: any) {
            return { success: false, error: (err as Error).message, results: [] };
        }
    },
});
