// src/tools/search_all_history_tools.ts
// Search across ALL sessions' semantic.jsonl files at once.
// Unlike search_chat_history (single session), this scans every channel/chat
// and returns ranked matches with their session key and timestamp.

import { tool } from "ai";
import { z } from "zod";
import { readdirSync, existsSync } from "fs";
import { resolve } from "path";
import { LOG_DIR } from "@/logs/activity-log.ts";
import { loadSemanticTurns } from "@/channels/semantic-store.ts";

const CHATS_DIR = resolve(LOG_DIR, "chats");

function listAllSessions(): string[] {
    if (!existsSync(CHATS_DIR)) return [];
    try {
        return readdirSync(CHATS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch { return []; }
}

export const search_all_history = tool({
    description:
        "Search ALL past conversations across every channel and session by keyword. " +
        "WHEN TO USE: recalling something from a past conversation when you don't know which channel or session it was in; " +
        "finding when a user last mentioned a topic, a past decision, or a config value that was discussed. " +
        "WHEN NOT TO USE: searching memory entities or facts — use memory__recall instead; " +
        "you already know the session — pass session_filter to restrict search. " +
        "Use specific multi-word queries: 'api key telegram setup' beats 'api'. " +
        "Returns ranked results (score = keyword hits) with session name, timestamp, and full turn text. " +
        "Example: {query: 'cron schedule daily 9am report', session_filter: 'telegram', top_k: 5}",
    inputSchema: z.object({
        query: z.string().describe(
            "Keywords or phrase to search for. Be specific — 'deploy cron schedule' is better than 'deploy'."
        ),
        top_k: z.number().optional().describe("Max results to return. Default: 10."),
        session_filter: z.string().optional().describe(
            "Optional: restrict search to sessions whose key contains this string. " +
            "E.g. 'telegram' to search only Telegram sessions, 'self' for self-agent sessions."
        ),
    }),
    execute: async (input) => {
        const topK = input.top_k ?? 10;
        const keywords = input.query.toLowerCase().split(/\s+/).filter(Boolean);

        if (keywords.length === 0) {
            return { success: false, error: "Query must contain at least one keyword." };
        }

        const sessions = listAllSessions().filter((s) =>
            input.session_filter ? s.includes(input.session_filter) : true
        );

        if (sessions.length === 0) {
            return { success: false, error: "No conversation sessions found." };
        }

        type Hit = {
            session: string;
            turn_index: number;
            score: number;
            timestamp: string;
            user: string;
            assistant: string;
            tools: string[];
        };

        const hits: Hit[] = [];

        for (const session of sessions) {
            const turns = loadSemanticTurns(session);
            for (let i = 0; i < turns.length; i++) {
                const turn = turns[i];
                const text = (turn.user + " " + turn.assistant).toLowerCase();
                const score = keywords.reduce(
                    (sum, kw) => sum + (text.includes(kw) ? 1 : 0),
                    0
                );
                if (score === 0) continue;
                hits.push({
                    session,
                    turn_index: i,
                    score,
                    timestamp: new Date(turn.ts).toLocaleString(),
                    user: turn.user.slice(0, 300),
                    assistant: turn.assistant.slice(0, 400),
                    tools: turn.tools ?? [],
                });
            }
        }

        if (hits.length === 0) {
            return {
                success: true,
                results: [],
                sessions_searched: sessions.length,
                message: "No matches found across any session.",
            };
        }

        hits.sort((a, b) => b.score - a.score || b.turn_index - a.turn_index);
        const results = hits.slice(0, topK);

        return {
            success: true,
            results,
            sessions_searched: sessions.length,
            total_matches: hits.length,
        };
    },
});
