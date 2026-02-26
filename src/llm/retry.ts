// src/llm/retry.ts — Exponential backoff retry wrapper for LLM calls.
// Retries on 429 and 5xx only; fails fast on 401/400.
//
// Handles transient errors from LLM providers via OpenRouter or direct APIs:
//   - APICallError with isRetryable (408 timeout, 409 conflict, 429 rate-limit, 5xx server errors)
//   - InvalidResponseDataError — provider returned non-JSON (e.g. HTML gateway error page)
//   - JSONParseError — response body couldn't be parsed
//
// NOT retried: 400 bad request, 401 auth, 403 forbidden — these are permanent failures.

import { APICallError, InvalidResponseDataError, JSONParseError } from "@ai-sdk/provider";
import { log } from "@/logs/logger.ts";

const logger = log("llm:retry");

/** Maximum number of retry attempts (not counting the first try). */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff. Doubles each retry. */
const BASE_DELAY_MS = 1_000;

/** Maximum delay cap in ms. */
const MAX_DELAY_MS = 30_000;

/**
 * Returns true if the error is a transient failure worth retrying.
 * Covers:
 *  - APICallError with .isRetryable (408/409/429/5xx)
 *  - InvalidResponseDataError (provider returned non-JSON — often a temporary gateway error)
 *  - JSONParseError (response body couldn't be parsed)
 */
function isRetryable(error: unknown): boolean {
    if (APICallError.isInstance(error)) {
        return (error as APICallError).isRetryable;
    }
    if (error instanceof InvalidResponseDataError) return true;
    if (error instanceof JSONParseError) return true;
    // Wrapped errors — look one level deeper
    const cause = (error as any)?.cause;
    if (cause) return isRetryable(cause);
    // "Invalid JSON response" string match — fallback for unwrapped errors
    const msg = (error as any)?.message ?? "";
    if (msg.includes("Invalid JSON response")) return true;
    return false;
}

/**
 * Runs `fn` with exponential backoff retry on transient LLM errors.
 *
 * @param fn     — async function to invoke (the generateText / streamText call)
 * @param label  — short description used in logs (e.g. "generateText:telegram")
 * @returns      — resolved value of `fn`
 * @throws       — rethrows after MAX_RETRIES exhausted, or on non-retryable errors
 */
export async function withRetry<T>(fn: () => Promise<T>, label = "llm"): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (!isRetryable(err)) {
                // Permanent failure — fail fast
                logger.error(`[${label}] non-retryable error: ${(err as any)?.message ?? err}`);
                throw err;
            }

            if (attempt === MAX_RETRIES) break;

            const delayMs = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
            const status = APICallError.isInstance(err) ? ` (status ${(err as APICallError).statusCode})` : "";
            logger.warn(`[${label}] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed${status} — retrying in ${delayMs}ms: ${(err as any)?.message?.slice(0, 120)}`);

            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    logger.error(`[${label}] all ${MAX_RETRIES + 1} attempts failed`);
    throw lastError;
}
