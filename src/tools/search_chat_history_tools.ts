// src/tools/search_chat_history_tools.ts — Semantic search over past conversations.
//
// Uses vector embeddings to find relevant past conversation turns.
// The agent calls this when it needs context about something discussed earlier
// that may have fallen outside the recent history window.

import { tool } from "ai";
import { z } from "zod";
import { searchHistory, backfillEmbeddings, getEmbeddingStats, embedNewTurns } from "@/channels/history-embeddings.ts";
import { loadHistory } from "@/channels/chat-store.ts";

export const IS_BOOTSTRAP_TOOL = true;

export const search_chat_history = tool({
    description:
        "Search past conversation history using semantic/vector search. " +
        "Use this when you need context about something discussed in a previous conversation " +
        "that is not in the recent chat history — e.g. past decisions, earlier instructions, " +
        "or topics from days/weeks ago. Always provide the chat_id from the current conversation.",
    inputSchema: z.object({
        query: z.string().describe(
            "Natural language search query — describe what you're looking for. " +
            "Be specific: 'when did we set up the cron job' is better than 'cron'."
        ),
        chat_id: z.number().describe(
            "Telegram chat ID to search history for. You can find this in the message JSON."
        ),
        top_k: z.number().optional().describe(
            "Number of results to return. Default: 5. Use more for broad searches."
        ),
    }),
    execute: async (input) => {
        const sessionKey = `telegram-${input.chat_id}`;

        try {
            // Check if embeddings exist
            const stats = getEmbeddingStats(sessionKey);

            // If no embeddings yet, try to backfill first
            if (stats.totalChunks === 0) {
                const history = loadHistory(sessionKey);
                if (history.length === 0) {
                    return { success: false, error: "No conversation history found for this chat." };
                }

                // Trigger backfill — this may take a moment for large histories
                const result = await backfillEmbeddings(sessionKey, history);
                if (result.chunksEmbedded === 0) {
                    return { success: false, error: "No conversation turns found to embed." };
                }
            } else {
                // Ensure latest turns are embedded
                const history = loadHistory(sessionKey);
                if (history.length > stats.lastMsgIdx) {
                    // Embed synchronously so search includes latest turns
                    embedNewTurns(sessionKey, history);
                    // Small delay to let the async embedding complete
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            // Perform semantic search
            const results = await searchHistory(input.query, sessionKey, input.top_k);

            if (results.length === 0) {
                return {
                    success: true,
                    results: [],
                    message: "No relevant past conversations found for this query.",
                };
            }

            // Format results for the agent
            const formatted = results.map((r, i) => ({
                rank: i + 1,
                score: Math.round(r.score * 1000) / 1000,
                conversation: r.text,
                history_range: `messages ${r.msgStartIdx}–${r.msgEndIdx}`,
            }));

            return {
                success: true,
                results: formatted,
                total_embedded_turns: getEmbeddingStats(sessionKey).totalChunks,
            };
        } catch (err: any) {
            return { success: false, error: err.message ?? String(err) };
        }
    },
});
