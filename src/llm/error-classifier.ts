// src/llm/error-classifier.ts — Classifies LLM errors into categories with user-facing messages.
//
// Used by:
// - retry.ts: decides whether to retry
// - channels: shows clean messages instead of raw SDK errors

import {
    APICallError,
    InvalidResponseDataError,
    JSONParseError,
    LoadAPIKeyError,
    NoContentGeneratedError,
    NoSuchModelError,
    InvalidPromptError,
    UnsupportedFunctionalityError,
} from "@ai-sdk/provider";

// ── Error categories ─────────────────────────────────────────────────────────

export type ErrorCategory =
    | "rate-limit"         // 429 — too many requests
    | "server-error"       // 5xx — provider is down
    | "timeout"            // 408 — request timed out
    | "auth-expired"       // 401/403 — bad API key
    | "bad-request"        // 400 — malformed request
    | "model-not-found"    // 404 or NoSuchModelError
    | "content-filtered"   // Provider refused to generate (safety filter)
    | "insufficient-credits" // 402 or provider-specific credit error
    | "invalid-response"   // Provider returned garbage (HTML, empty, etc.)
    | "config-error"       // Missing API key, unsupported feature
    | "prompt-error"       // Invalid/too-long prompt
    | "unknown";           // Unrecognized error

export interface ClassifiedError {
    /** Error category for programmatic use */
    category: ErrorCategory;
    /** Whether retry may help */
    retryable: boolean;
    /** Clean message safe to show to the user */
    userMessage: string;
    /** HTTP status code, if available */
    statusCode?: number;
    /** Original error for logging */
    original: unknown;
}

// ── User-facing messages per category ────────────────────────────────────────

const USER_MESSAGES: Record<ErrorCategory, string> = {
    "rate-limit": "The AI service is busy right now. Retrying automatically…",
    "server-error": "The AI provider is experiencing issues. Retrying…",
    "timeout": "The request timed out. Retrying…",
    "auth-expired": "API key is invalid or expired. Please check your credentials.",
    "bad-request": "The request was malformed. This is likely a bug — please report it.",
    "model-not-found": "The configured model was not found. Check the model ID in config.",
    "content-filtered": "The AI provider blocked the response due to content policy. Try rephrasing.",
    "insufficient-credits": "API credits exhausted. Please top up your account.",
    "invalid-response": "The AI provider returned an invalid response. Retrying…",
    "config-error": "Configuration error — missing API key or unsupported feature.",
    "prompt-error": "The prompt was too long or invalid. Try a shorter message.",
    "unknown": "Something went wrong with the AI service. Please try again.",
};

// ── Provider-specific patterns ───────────────────────────────────────────────
// These match common error message substrings from various providers.

const CREDIT_PATTERNS = [
    "insufficient_quota",
    "insufficient credits",
    "billing",
    "payment required",
    "exceeded your current quota",
    "account has been suspended",
    "credit",
];

const CONTENT_FILTER_PATTERNS = [
    "content_filter",
    "content management policy",
    "content_policy",
    "safety filter",
    "moderation",
    "flagged",
    "blocked by",
    "responsible ai",
];

// ── Main classifier ─────────────────────────────────────────────────────────

/**
 * Classifies an LLM error into a structured result with category, retryability,
 * and a clean user-facing message.
 */
export function classifyError(error: unknown): ClassifiedError {
    const make = (category: ErrorCategory, statusCode?: number): ClassifiedError => ({
        category,
        retryable: RETRYABLE_CATEGORIES.has(category),
        userMessage: USER_MESSAGES[category],
        statusCode,
        original: error,
    });

    // ── 1. AI SDK typed errors ───────────────────────────────────────────────

    // APICallError — most common, has statusCode + isRetryable
    if (APICallError.isInstance(error)) {
        const apiErr = error as APICallError;
        const status = apiErr.statusCode;
        const body = (apiErr.responseBody ?? "").toLowerCase();
        const msg = (apiErr.message ?? "").toLowerCase();

        // Check for specific categories by status code
        if (status === 429) return make("rate-limit", 429);
        if (status === 408) return make("timeout", 408);
        if (status === 401 || status === 403) return make("auth-expired", status);
        if (status === 402) return make("insufficient-credits", 402);
        if (status === 404) return make("model-not-found", 404);

        // Check body/message for provider-specific patterns
        if (matchesAny(body + msg, CREDIT_PATTERNS)) return make("insufficient-credits", status);
        if (matchesAny(body + msg, CONTENT_FILTER_PATTERNS)) return make("content-filtered", status);

        // 400 — could be prompt too long or generic bad request
        if (status === 400) {
            if (msg.includes("too long") || msg.includes("maximum context") || msg.includes("token limit")) {
                return make("prompt-error", 400);
            }
            return make("bad-request", 400);
        }

        // 5xx server errors
        if (status && status >= 500) return make("server-error", status);

        // Fall through: use SDK's own isRetryable flag
        if (apiErr.isRetryable) return make("server-error", status);

        return make("unknown", status);
    }

    // NoSuchModelError — model ID is wrong
    if (error instanceof NoSuchModelError) return make("model-not-found");

    // LoadAPIKeyError — missing env var
    if (error instanceof LoadAPIKeyError) return make("config-error");

    // UnsupportedFunctionalityError — model doesn't support the feature
    if (error instanceof UnsupportedFunctionalityError) return make("config-error");

    // InvalidPromptError — prompt validation failed
    if (error instanceof InvalidPromptError) return make("prompt-error");

    // NoContentGeneratedError — model generated nothing
    if (error instanceof NoContentGeneratedError) return make("content-filtered");

    // InvalidResponseDataError — provider returned non-JSON (gateway error page)
    if (error instanceof InvalidResponseDataError) return make("invalid-response");

    // JSONParseError — response couldn't be parsed
    if (error instanceof JSONParseError) return make("invalid-response");

    // ── 2. Generic error / wrapped cause ─────────────────────────────────────

    const msg = ((error as any)?.message ?? "").toLowerCase();

    // Network-level errors
    if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("econnreset")) {
        return make("server-error");
    }
    if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("abort")) {
        return make("timeout");
    }
    if (msg.includes("invalid json response")) {
        return make("invalid-response");
    }

    // Check for provider-specific patterns in generic errors
    if (matchesAny(msg, CREDIT_PATTERNS)) return make("insufficient-credits");
    if (matchesAny(msg, CONTENT_FILTER_PATTERNS)) return make("content-filtered");

    // Check wrapped cause (one level deep)
    const cause = (error as any)?.cause;
    if (cause && cause !== error) {
        const inner = classifyError(cause);
        if (inner.category !== "unknown") return inner;
    }

    return make("unknown");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const RETRYABLE_CATEGORIES = new Set<ErrorCategory>([
    "rate-limit",
    "server-error",
    "timeout",
    "invalid-response",
]);

function matchesAny(text: string, patterns: string[]): boolean {
    return patterns.some((p) => text.includes(p));
}

/**
 * Quick check: is this error worth retrying?
 * Equivalent to `classifyError(error).retryable` but slightly cheaper for
 * hot paths where the full classification isn't needed.
 */
export function isRetryableError(error: unknown): boolean {
    return classifyError(error).retryable;
}
