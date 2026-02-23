/**
 * Post-flight Quality Gate — structured check after generation completes.
 *
 * Mirrors the pre-flight: a fast `generateObject()` call that evaluates
 * whether the agent's response actually answers the user's question.
 *
 * If the response is empty or incomplete, signals that a retry with
 * the powerful tier is warranted. Catches the `outputTokens: 0` problem
 * systematically instead of relying solely on the text-fallback chain.
 *
 * Cost: ~50–100 tokens on the fast tier (fractions of a cent).
 *
 * @module llm/postflight
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { ModelRouter } from './router';
import { getConfig } from '../config';

// ── Schema ─────────────────────────────────────────────

export const PostflightSchema = z.object({
    answeredQuestion: z.boolean().describe(
        'true if the response directly answers or fulfills the user request',
    ),
    isComplete: z.boolean().describe(
        'true if the response is a full answer (not cut off, not just a plan)',
    ),
    shouldRetry: z.boolean().describe(
        'true if the response is empty, incomplete, or does not address the question — a retry with a stronger model is warranted',
    ),
    reason: z.string().describe(
        'Brief reason for the verdict (1 sentence)',
    ),
});

export type PostflightResult = z.infer<typeof PostflightSchema>;

// ── System prompt ──────────────────────────────────────

const POSTFLIGHT_SYSTEM = `You are a response quality evaluator. Given a user question and the agent's response, determine:
1. answeredQuestion: Does the response actually answer what was asked?
2. isComplete: Is it a full answer (not truncated, not just "I'll do X" without doing it)?
3. shouldRetry: Should we retry with a more capable model? (true if empty, off-topic, or only partially answers)
4. reason: One sentence explaining your verdict.

Rules:
- An empty or whitespace-only response ALWAYS gets shouldRetry: true
- A response that only says "I'll look into it" without actual results = shouldRetry: true
- A valid partial answer is better than nothing — only shouldRetry if critical info is missing
- Greetings and simple acknowledgments are valid responses for simple questions`;

// ── Main Function ──────────────────────────────────────

/**
 * Evaluate the quality of an agent response after generation.
 *
 * @param userMessage  - The user's original question
 * @param response     - The resolved agent response text
 * @param router       - Model router (uses fast tier)
 * @returns PostflightResult or null on error (never blocks)
 */
export async function runPostflight(
    userMessage: string,
    response: string,
    router: ModelRouter,
): Promise<PostflightResult | null> {
    // Skip postflight for empty responses — we already know the verdict
    if (!response.trim()) {
        return {
            answeredQuestion: false,
            isComplete: false,
            shouldRetry: true,
            reason: 'Response is empty.',
        };
    }

    try {
        const { model } = router.getModelByTier('fast');
        const cfg = getConfig().agent;

        const { output } = await generateText({
            model,
            output: Output.object({ schema: PostflightSchema }),
            system: POSTFLIGHT_SYSTEM,
            prompt: `User question: ${userMessage}\n\nAgent response: ${response.slice(0, cfg.postflightMaxResponseChars)}`,
            temperature: 0,
            maxRetries: cfg.flightMaxRetries,
        });

        return output;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[Postflight]: Failed — skipping quality gate. ${msg.slice(0, 150)}`);
        return null;
    }
}
