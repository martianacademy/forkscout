// src/llm/retry.ts — Exponential backoff retry wrapper for LLM calls.
// Uses error-classifier.ts to decide retryability — no inline heuristics.
//
// Retryable: 429 rate-limit, 5xx server-error, 408 timeout, invalid-response
// NOT retried: 401/403 auth, 400 bad-request, 404 model-not-found — permanent.

import { APICallError } from "@ai-sdk/provider";
import { classifyError, type ClassifiedError } from "@/llm/error-classifier.ts";
import { log } from "@/logs/logger.ts";

const logger = log("llm:retry");

/** Maximum number of retry attempts (not counting the first try). */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff. Doubles each retry. */
const BASE_DELAY_MS = 1_000;

/** Maximum delay cap in ms. */
const MAX_DELAY_MS = 30_000;

/**
 * Error thrown when all retries are exhausted, wrapping the classified result.
 * Channels can read `.classified` for clean user-facing messages.
 */
export class LLMError extends Error {
    readonly classified: ClassifiedError;
    constructor(classified: ClassifiedError) {
        super(classified.userMessage);
        this.name = "LLMError";
        this.classified = classified;
        this.cause = classified.original;
    }
}

/**
 * Runs `fn` with exponential backoff retry on transient LLM errors.
 *
 * @param fn     — async function to invoke (the generateText / streamText call)
 * @param label  — short description used in logs (e.g. "generateText:telegram")
 * @returns      — resolved value of `fn`
 * @throws       — LLMError after MAX_RETRIES exhausted, or on non-retryable errors
 */
export async function withRetry<T>(fn: () => Promise<T>, label = "llm"): Promise<T> {
    let lastClassified: ClassifiedError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const classified = classifyError(err);
            lastClassified = classified;

            if (!classified.retryable) {
                // Permanent failure — fail fast with clean message
                logger.error(`[${label}] fatal ${classified.category}: ${(err as any)?.message ?? err}`);
                throw new LLMError(classified);
            }

            if (attempt === MAX_RETRIES) break;

            const delayMs = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
            const status = APICallError.isInstance(err) ? ` (status ${(err as APICallError).statusCode})` : "";
            logger.warn(`[${label}] attempt ${attempt + 1}/${MAX_RETRIES + 1} ${classified.category}${status} — retrying in ${delayMs}ms`);

            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    logger.error(`[${label}] all ${MAX_RETRIES + 1} attempts failed (${lastClassified!.category})`);
    throw new LLMError(lastClassified!);
}
