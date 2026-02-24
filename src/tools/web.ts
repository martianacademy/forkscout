// src/tools/web.ts — Web search and browsing
import { tool } from "ai";
import { z } from "zod";

export const webSearchTool = tool({
    description: "Search the web using DuckDuckGo and return top results",
    inputSchema: z.object({
        query: z.string().describe("Search query"),
        maxResults: z.number().optional().default(5).describe("Max results to return"),
    }),
    execute: async (input) => {
        const { query, maxResults = 5 } = input;
        try {
            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            const res = await fetch(url);
            const data = await res.json() as any;

            const results = (data.RelatedTopics ?? [])
                .filter((t: any) => t.Text && t.FirstURL)
                .slice(0, maxResults)
                .map((t: any) => ({ title: t.Text, url: t.FirstURL }));

            return { success: true, results };
        } catch (err: any) {
            return { success: false, error: (err as Error).message, results: [] };
        }
    },
});

export const browseWebTool = tool({
    description: "Fetch and read the text content of a web page",
    inputSchema: z.object({
        url: z.string().describe("URL of the page to browse"),
    }),
    execute: async (input) => {
        const { url } = input;
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; forkscout-agent/3.0)" },
            });
            const html = await res.text();

            // Strip HTML tags roughly
            const text = html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim()
                .slice(0, 8000);

            return { success: true, content: text, statusCode: res.status };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
