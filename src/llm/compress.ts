/**
 * Tool Result Compression — shrink large tool outputs to keep context lean.
 *
 * Large tool results (web pages, file contents, spawn_agents output) eat the
 * context window. This module provides a compression function that summarizes
 * outputs exceeding a character threshold using the fast tier model.
 *
 * Integrated into `prepareStep` so compression happens transparently between
 * steps — the model sees concise summaries instead of massive raw dumps.
 *
 * @module llm/compress
 */

import { generateText } from 'ai';
import type { ModelRouter } from './router';
import { getConfig } from '../config';

/** System prompt for the fast-tier compression model */
const COMPRESS_SYSTEM = `You are a compression assistant. Summarize the tool output below into a concise version that preserves all key facts, data points, errors, and actionable information. Remove boilerplate, HTML tags, and repetition. Output ONLY the summary, no preamble.`;

/**
 * Compress tool results in a step's messages if they exceed the threshold.
 *
 * Mutates the messages array in-place for efficiency (AI SDK passes a mutable copy).
 * Only compresses results from steps before the current one.
 *
 * @param messages - The full message array from the ToolLoopAgent
 * @param stepNumber - Current step number (0-indexed)
 * @param router - Model router for fast tier access
 * @returns Number of results compressed
 */
export async function compressLargeToolResults(
    messages: Array<any>,
    stepNumber: number,
    router: ModelRouter,
): Promise<number> {
    const cfg = getConfig().agent;
    if (stepNumber < cfg.compressAfterStep) return 0;

    let compressed = 0;
    const { model } = router.getModelByTier('fast');

    for (const msg of messages) {
        // Only process tool-result messages
        if (msg.role !== 'tool') continue;

        const parts: any[] = msg.content ?? msg.parts ?? [];
        for (const part of parts) {
            if (part.type !== 'tool-result') continue;

            const raw = typeof part.result === 'string'
                ? part.result
                : JSON.stringify(part.result ?? '');

            if (raw.length <= cfg.compressThreshold) continue;

            // Already compressed in a previous step
            if (raw.startsWith('[Compressed]')) continue;

            try {
                const { text: summary } = await generateText({
                    model,
                    system: COMPRESS_SYSTEM,
                    prompt: `Tool: ${part.toolName || 'unknown'}\nOutput (${raw.length} chars):\n${raw.slice(0, cfg.compressInputMaxChars)}`,
                    temperature: 0,
                });

                part.result = `[Compressed] ${summary.slice(0, cfg.compressMaxSummary)}`;
                compressed++;
            } catch {
                // Compression failed — leave original in place
            }
        }
    }

    if (compressed > 0) {
        console.log(`[Compress]: Compressed ${compressed} large tool result(s) at step ${stepNumber}`);
    }
    return compressed;
}
