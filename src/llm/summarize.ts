/**
 * src/llm/summarize.ts
 *
 * LLM-powered abstractive summarisation using the fast tier model.
 *
 * Unlike extractive summarisation (which picks existing sentences),
 * this synthesises the content — rephrasing, merging ideas, and dropping
 * redundancy — producing genuinely condensed, readable output.
 *
 * Falls back to extractive summarisation if the LLM call fails,
 * so it never throws.
 */

import { generateText } from "ai";
import { getConfig } from "@/config.ts";
import { getModelForRole } from "@/providers/index.ts";
import { extractiveSummary } from "@/utils/extractive-summary.ts";
import { log } from "@/logs/logger.ts";

const logger = log("llm-summarize");

export interface LLMSummarizeOptions {
    /**
     * Max tokens for the summary output.
     * Defaults to `config.llm.llmSummarizeMaxTokens` (set to 1200 in forkscout.config.json).
     */
    maxOutputTokens?: number;
    /**
     * Override the default summarisation instruction.
     * The text to summarise is always appended after the instruction.
     */
    instruction?: string;
}

const DEFAULT_INSTRUCTION =
    "Summarise the following content into concise, meaningful key points. " +
    "Preserve all important facts, numbers, names, and conclusions. " +
    "Drop filler, repetition, and boilerplate. " +
    "Write in clear prose — not bullet points unless the input is structured data. " +
    "Be direct and dense: every sentence must carry information.";

/**
 * Synthesise `text` into a concise summary using the fast-tier LLM.
 * Falls back to extractive summarisation if the LLM call fails.
 *
 * @example
 * const summary = await llmSummarize(longWebPage);
 * const custom  = await llmSummarize(report, { instruction: "Extract only action items." });
 */
export async function llmSummarize(
    text: string,
    opts: LLMSummarizeOptions = {}
): Promise<string> {
    if (!text || text.trim().length === 0) return "";

    const config = getConfig();
    const { maxOutputTokens = config.llm.llmSummarizeMaxTokens, instruction = DEFAULT_INSTRUCTION } = opts;

    try {
        const model = getModelForRole("summarizer", config.llm);
        const { text: summary } = await generateText({
            model,
            system: instruction,
            prompt: text,
            maxOutputTokens,
        });
        return summary.trim();
    } catch (err: any) {
        logger.error(`LLM summarise failed (role=summarizer, provider=${config.llm.provider}): ${err?.message} — falling back to extractive`, err);
        return extractiveSummary(text, { maxSentences: 8 });
    }
}
