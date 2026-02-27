// src/tools/rss_tools.ts
//
// RSS/Atom feed reader — zero extra deps (fetch + node-html-parser for XML).
//
// Actions:
//   fetch    — read a feed URL, return items (title, link, date, summary)
//   preview  — return only the N most recent items (fast summary)
//   search   — filter feed items by keyword in title or description
//
// Supports RSS 2.0, RSS 1.0 (RDF), and Atom 1.0 feed formats.
// Use with cron jobs to build a research monitor: schedule fetch + store to sqlite.

import { tool } from "ai";
import { z } from "zod";
import { parse } from "node-html-parser";

export const IS_BOOTSTRAP_TOOL = false;

interface FeedItem {
    title: string;
    link: string;
    date: string | null;
    summary: string;
    author: string | null;
}

interface FeedResult {
    feed_title: string;
    feed_link: string;
    item_count: number;
    items: FeedItem[];
}

async function fetchFeedText(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
                "User-Agent": "ForkScout/3.0 (+https://github.com/martianacademy/forkscout)",
            },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

function stripHtml(html: string): string {
    return parse(html).text.replace(/\s+/g, " ").trim();
}

function parseFeed(xml: string): FeedResult {
    const root = parse(xml, { comment: false });

    // ── Atom ────────────────────────────────────────────────────────────────
    const isAtom = root.querySelector("feed") !== null;
    if (isAtom) {
        const feed = root.querySelector("feed")!;
        const feedTitle = feed.querySelector("title")?.text.trim() ?? "Untitled";
        const feedLink =
            feed.querySelector("link[rel=alternate]")?.getAttribute("href") ??
            feed.querySelector("link")?.getAttribute("href") ??
            "";

        const entries = feed.querySelectorAll("entry");
        const items: FeedItem[] = entries.map((entry) => ({
            title: entry.querySelector("title")?.text.trim() ?? "",
            link:
                entry.querySelector("link[rel=alternate]")?.getAttribute("href") ??
                entry.querySelector("link")?.getAttribute("href") ??
                "",
            date:
                entry.querySelector("published")?.text.trim() ??
                entry.querySelector("updated")?.text.trim() ??
                null,
            summary: stripHtml(
                entry.querySelector("summary")?.innerHTML ??
                entry.querySelector("content")?.innerHTML ??
                ""
            ).slice(0, 500),
            author: entry.querySelector("author name")?.text.trim() ?? null,
        }));

        return { feed_title: feedTitle, feed_link: feedLink, item_count: items.length, items };
    }

    // ── RSS 2.0 / RSS 1.0 (RDF) ─────────────────────────────────────────────
    const channel = root.querySelector("channel") ?? root;
    const feedTitle = channel.querySelector("title")?.text.trim() ?? "Untitled";
    const feedLink = channel.querySelector("link")?.text.trim() ?? "";

    const rssItems = root.querySelectorAll("item");
    const items: FeedItem[] = rssItems.map((item) => ({
        title: item.querySelector("title")?.text.trim() ?? "",
        link: item.querySelector("link")?.text.trim() ?? "",
        date:
            item.querySelector("pubDate")?.text.trim() ??
            item.querySelector("dc\\:date")?.text.trim() ??
            null,
        summary: stripHtml(
            item.querySelector("description")?.innerHTML ??
            item.querySelector("content\\:encoded")?.innerHTML ??
            ""
        ).slice(0, 500),
        author:
            item.querySelector("author")?.text.trim() ??
            item.querySelector("dc\\:creator")?.text.trim() ??
            null,
    }));

    return { feed_title: feedTitle, feed_link: feedLink, item_count: items.length, items };
}

export const rss_tools = tool({
    description:
        "Read RSS and Atom feeds. " +
        "Actions: 'fetch' (get all items from a feed URL), 'preview' (N most recent items only), " +
        "'search' (filter items by keyword in title or description). " +
        "Returns title, link, date, author, and a text summary for each item. " +
        "Combine with sqlite_tools to persist items and self_cron_jobs_tools to poll feeds on a schedule.",
    inputSchema: z.object({
        action: z
            .enum(["fetch", "preview", "search"])
            .describe("Operation to perform"),
        url: z.string().url().describe("RSS or Atom feed URL"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20)
            .describe("Max items to return (default 20)"),
        keyword: z
            .string()
            .optional()
            .describe("Keyword to search for in title and description (required for 'search' action)"),
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

        let xml: string;
        try {
            xml = await fetchFeedText(input.url, timeoutMs);
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }

        let feed: FeedResult;
        try {
            feed = parseFeed(xml);
        } catch (err: any) {
            return { success: false, error: `Feed parse failed: ${(err as Error).message}` };
        }

        const limit = input.limit ?? 20;

        switch (input.action) {
            case "fetch":
                return {
                    success: true,
                    feed_title: feed.feed_title,
                    feed_link: feed.feed_link,
                    item_count: feed.item_count,
                    items: feed.items.slice(0, limit),
                };

            case "preview":
                return {
                    success: true,
                    feed_title: feed.feed_title,
                    item_count: feed.item_count,
                    items: feed.items.slice(0, limit).map((i) => ({
                        title: i.title,
                        link: i.link,
                        date: i.date,
                    })),
                };

            case "search": {
                if (!input.keyword) {
                    return { success: false, error: "keyword is required for the 'search' action" };
                }
                const kw = input.keyword.toLowerCase();
                const matched = feed.items.filter(
                    (i) =>
                        i.title.toLowerCase().includes(kw) ||
                        i.summary.toLowerCase().includes(kw)
                );
                return {
                    success: true,
                    feed_title: feed.feed_title,
                    keyword: input.keyword,
                    match_count: matched.length,
                    items: matched.slice(0, limit),
                };
            }

            default:
                return { success: false, error: `Unknown action: ${input.action}` };
        }
    },
});
