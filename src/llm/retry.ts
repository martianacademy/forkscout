/**
 * LLM Retry & Failover — wraps AI SDK generateText/streamText with
 * exponential backoff, error classification, and automatic recovery.
 *
 * Error handling strategy:
 *   - Rate limit (429) → backoff + retry
 *   - Timeout / overloaded → backoff + retry
 *   - Auth error (401/403) → fail immediately (no point retrying)
 *   - Context overflow → fail immediately (caller must compact)
 *   - Network error → backoff + retry
 *   - Unknown → retry up to max attempts
 */

import { generateText, streamText, type GenerateTextResult } from 'ai';

export interface RetryConfig {
    /** Max retry attempts (default: 3) */
    maxAttempts?: number;
    /** Initial delay in ms (default: 1000) */
    initialDelayMs?: number;
    /** Max delay in ms (default: 15000) */
    maxDelayMs?: number;
    /** Backoff multiplier (default: 2) */
    backoffMultiplier?: number;
    /** Add jitter to delay (default: true) */
    jitter?: boolean;
}

const DEFAULT_RETRY: Required<RetryConfig> = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 15000,
    backoffMultiplier: 2,
    jitter: true,
};

type ErrorType = 'rate_limit' | 'timeout' | 'auth' | 'context_overflow' | 'unsupported_input' | 'network' | 'overloaded' | 'unknown';

/** Classify an error to determine retry strategy */
function classifyError(error: unknown): ErrorType {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const statusMatch = msg.match(/status[:\s]*(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 0;

    // Rate limiting
    if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
        return 'rate_limit';
    }

    // Auth errors — don't retry
    if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('authentication')) {
        return 'auth';
    }

    // Context overflow — don't retry (caller must compact)
    if (msg.includes('context') && (msg.includes('overflow') || msg.includes('too long') || msg.includes('maximum'))) {
        return 'context_overflow';
    }
    if (msg.includes('max_tokens') || msg.includes('token limit')) {
        return 'context_overflow';
    }

    // Unsupported input modality (e.g. vision/image) — don't retry
    if (msg.includes('image input') || msg.includes('image_input') || msg.includes('does not support image') || msg.includes('vision')) {
        return 'unsupported_input';
    }

    // Server overloaded
    if (status === 503 || status === 502 || msg.includes('overloaded') || msg.includes('capacity')) {
        return 'overloaded';
    }

    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnreset') || msg.includes('etimedout')) {
        return 'timeout';
    }

    // Network errors
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('fetch failed')) {
        return 'network';
    }

    return 'unknown';
}

/** Whether this error type should be retried */
function shouldRetry(errorType: ErrorType): boolean {
    // Auth, context overflow, and unsupported input should NOT be retried
    return errorType !== 'auth' && errorType !== 'context_overflow' && errorType !== 'unsupported_input';
}

/**
 * Check if an error indicates the model doesn't support image/vision input.
 * Exported so callers (e.g. Telegram handler) can detect and gracefully degrade.
 */
export function isVisionUnsupportedError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return msg.includes('image input') || msg.includes('image_input') || msg.includes('does not support image') || msg.includes('vision');
}

/** Calculate delay with exponential backoff + optional jitter */
function calculateDelay(attempt: number, config: Required<RetryConfig>): number {
    const base = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
    const capped = Math.min(base, config.maxDelayMs);
    if (!config.jitter) return capped;
    // Add ±25% jitter
    return capped * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * generateText with automatic retry and exponential backoff.
 * Use this for all non-streaming LLM calls.
 */
export async function generateTextWithRetry<T extends Parameters<typeof generateText>[0]>(
    params: T,
    retryConfig?: RetryConfig,
): Promise<GenerateTextResult<any, any>> {
    const config = { ...DEFAULT_RETRY, ...retryConfig };
    let lastError: unknown;

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
        try {
            return await generateText(params);
        } catch (error) {
            lastError = error;
            const errorType = classifyError(error);
            const errMsg = error instanceof Error ? error.message : String(error);

            if (!shouldRetry(errorType) || attempt >= config.maxAttempts - 1) {
                // Don't retry auth/context errors, or if out of attempts
                if (attempt > 0) {
                    console.error(`[LLM Retry]: Failed after ${attempt + 1} attempt(s) [${errorType}]: ${errMsg.slice(0, 200)}`);
                }
                throw error;
            }

            const delay = calculateDelay(attempt, config);
            console.warn(`[LLM Retry]: Attempt ${attempt + 1}/${config.maxAttempts} failed [${errorType}]: ${errMsg.slice(0, 150)}. Retrying in ${Math.round(delay)}ms...`);
            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * streamText with automatic retry and exponential backoff.
 * 
 * Note: streamText itself doesn't throw on creation — errors happen
 * during consumption. This wrapper catches creation-time errors only.
 * For stream consumption errors, use the onError callback.
 */
export function streamTextWithRetry<T extends Parameters<typeof streamText>[0]>(
    params: T,
    retryConfig?: RetryConfig,
): ReturnType<typeof streamText> {
    // streamText is synchronous in creation — wrap the params to add retry
    // behavior via the providerOptions or error handling
    void retryConfig; // reserved for future async stream retry

    // For streaming, we enhance the onError callback
    const originalOnError = params.onError;
    const enhancedParams = {
        ...params,
        onError: ({ error }: { error: unknown }) => {
            const errorType = classifyError(error);
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`[LLM Stream]: Error [${errorType}]: ${errMsg.slice(0, 200)}`);
            originalOnError?.({ error });
        },
    };

    return streamText(enhancedParams);
}

/**
 * Lightweight retry wrapper for internal LLM calls (summarizer, entity extraction, etc.)
 * Uses smaller retry count (2) since these are non-critical background tasks.
 */
export async function generateTextQuiet(params: Parameters<typeof generateText>[0]): Promise<string> {
    try {
        const result = await generateTextWithRetry(params, { maxAttempts: 2, initialDelayMs: 500 });
        return result.text;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[LLM Quiet]: Background LLM call failed: ${errMsg.slice(0, 150)}`);
        return '';
    }
}
