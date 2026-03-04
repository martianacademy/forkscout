// src/tools/semantic_search_history_tools.ts — Search past conversation turns semantically
import { tool } from "ai";
import { z } from "zod";
import { loadSemanticTurns } from "@/channels/semantic-store.ts";


export const semantic_search_history = tool({
    description: "Search past conversation history for this session. Call this at the start of a task to recall previous context, decisions, or work done. Skip for simple greetings or trivial questions.",
    inputSchema: z.object({
        session_key: z.string().describe("Session key shown in your system prompt (e.g. telegram-123456)"),
        query: z.string().describe("What to search for — keywords, task description, or topic"),
        limit: z.number().optional().describe("Max turns to return (default 8)"),
    }),
    execute: async (input) => {
        const turns = loadSemanticTurns(input.session_key);
        if (turns.length === 0) return { success: true, results: [], message: "No history found for this session." };

        const limit = input.limit ?? 8;
        const q = input.query.toLowerCase();
        const words = q.split(/\s+/).filter(w => w.length > 3);

        // Score each turn by keyword overlap
        const scored = turns.map(t => {
            const haystack = `${t.user} ${t.assistant} ${t.tools.join(" ")}`.toLowerCase();
            const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
            return { turn: t, score };
        });

        // Sort by score desc, then recency for ties
        scored.sort((a, b) => b.score - a.score || b.turn.ts - a.turn.ts);

        const top = scored.slice(0, limit).map(({ turn }) => ({
            date: new Date(turn.ts).toLocaleString(),
            user: turn.user,
            assistant: turn.assistant,
            tools: turn.tools,
        }));

        return { success: true, results: top, total_turns: turns.length };
    },
});
