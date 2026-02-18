/**
 * Token counting utility — wraps gpt-tokenizer for accurate token budgets.
 *
 * Uses cl100k_base encoding (GPT-4/GPT-3.5 tokenizer) which is a reasonable
 * approximation for most modern LLMs (including those on OpenRouter).
 */

import { encode } from 'gpt-tokenizer';

/**
 * Count tokens in a string using cl100k_base encoding.
 * This is the tokenizer used by GPT-4 and is a good approximation
 * for most modern LLMs.
 */
export function countTokens(text: string): number {
    if (!text) return 0;
    try {
        return encode(text).length;
    } catch {
        // Fallback: rough approximation (1 token ≈ 4 chars for English)
        return Math.ceil(text.length / 4);
    }
}

/**
 * Truncate text to fit within a token budget.
 * Tries to break at sentence boundaries.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
    const tokens = countTokens(text);
    if (tokens <= maxTokens) return text;

    // Binary search for the right length
    let low = 0;
    let high = text.length;
    let best = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const slice = text.slice(0, mid);
        if (countTokens(slice) <= maxTokens) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    // Try to break at a sentence boundary
    const truncated = text.slice(0, best);
    const lastPeriod = truncated.lastIndexOf('. ');
    const lastNewline = truncated.lastIndexOf('\n');
    const breakAt = Math.max(lastPeriod, lastNewline);

    if (breakAt > best * 0.7) {
        return truncated.slice(0, breakAt + 1) + '…';
    }

    return truncated + '…';
}
