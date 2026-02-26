/**
 * src/tools/compress_text.ts
 *
 * Text compression tool with two modes:
 *
 *   "extractive" (default) — picks the most informative existing sentences.
 *                            Instant, no LLM call, zero cost.
 *
 *   "llm"                  — calls the fast-tier LLM to synthesise the content.
 *                            Produces genuinely condensed, rephrased prose.
 *                            Costs tokens but gives the best quality summary.
 *
 * Use when:
 * - web_search or browse_web returns more content than needed
 * - a read_file result is very long and only the key points matter
 * - you want to fit large content into a response without losing meaning
 */

import { tool } from "ai";
import { z } from "zod";
import { extractiveSummary } from "@/utils/extractive-summary.ts";
import { llmSummarize } from "@/llm/summarize.ts";

export const IS_BOOTSTRAP_TOOL = false;

export const compress_text_tools = tool({
    description:
        "Condense long text (web pages, search results, file contents, command output) into a concise summary. " +
        "WHEN TO USE: automatically after any tool returns >500 words; always before quoting long content in a reply. " +
        "mode='extractive' (default): instant, no LLM — picks the most informative existing sentences. Best for 500-2000 words. " +
        "mode='llm': uses a fast cheap LLM to synthesise and rephrase — better quality, costs tokens. Use for >2000 words or when synthesis/insight is needed. " +
        "Never dump raw tool output into a response — compress it first.",
    inputSchema: z.object({
        text: z.string().describe("The long text to compress"),
        mode: z
            .enum(["extractive", "llm"])
            .default("extractive")
            .describe("'extractive' = pick top sentences (instant, free). 'llm' = synthesise with fast LLM (better quality)."),
        maxSentences: z
            .number()
            .int()
            .min(1)
            .max(50)
            .default(8)
            .describe("For extractive mode: how many key sentences to keep (default 8)"),
        maxTokens: z
            .number()
            .int()
            .min(50)
            .max(4000)
            .default(1200)
            .describe("For llm mode: max tokens in the output summary (default 1200)"),
        instruction: z
            .string()
            .optional()
            .describe("For llm mode: custom summarisation instruction (optional — leave blank for default)"),
    }),
    execute: async (input) => {
        const { text, mode, maxSentences, maxTokens, instruction } = input;
        if (!text || text.trim().length === 0) {
            return { success: false, error: "text is empty" };
        }

        const originalWords = text.split(/\s+/).filter(Boolean).length;

        if (mode === "llm") {
            const summary = await llmSummarize(text, { maxOutputTokens: maxTokens, instruction });
            const summaryWords = summary.split(/\s+/).filter(Boolean).length;
            return {
                success: true,
                mode: "llm",
                summary,
                stats: {
                    originalWords,
                    summaryWords,
                    compressionRatio: Math.round((1 - summaryWords / originalWords) * 100) + "%",
                },
            };
        }

        // extractive (default)
        const summary = extractiveSummary(text, { maxSentences });
        const summaryWords = summary.split(/\s+/).filter(Boolean).length;
        return {
            success: true,
            mode: "extractive",
            summary,
            stats: {
                originalWords,
                summaryWords,
                compressionRatio: Math.round((1 - summaryWords / originalWords) * 100) + "%",
            },
        };
    },
});
