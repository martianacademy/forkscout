// src/utils/secrets.ts — Mask secrets before sending to LLM
// NEVER let passwords, API keys, tokens reach the LLM

import { censorSecrets } from "@/secrets/vault.ts";

/**
 * Patterns that indicate secrets in user messages
 */
const SECRET_PATTERNS = [
    // Generic API key patterns
    /(?:api[_-]?key|apikey|api[_-]?token)["':\s=]+([a-zA-Z0-9_\-]{16,})/gi,
    // Generic secret patterns
    /(?:secret|password|passwd|pwd)["':\s=]+([^\s"']{6,})/gi,
    // Token patterns (long alphanumeric strings)
    /(?:token|auth)["':\s=]+([a-zA-Z0-9_\-\.]{20,})/gi,
    // Bearer tokens
    /Bearer\s+([a-zA-Z0-9_\-\.]+)/gi,
    // Private keys
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    // Database connection strings with password
    /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:([^@]+)@/gi,
];

const MASK = "[REDACTED_SECRET]";

/**
 * Check if a string looks like a secret value
 */
function looksLikeSecret(value: string): boolean {
    // Skip obvious placeholders
    if (value === "[REDACTED_SECRET]" || value === "REDACTED") return false;

    // Long random-looking strings are suspicious
    if (value.length > 20 && /^[a-zA-Z0-9_\-]+$/.test(value)) {
        return true;
    }

    // Common secret formats
    if (/^sk\-[a-zA-Z0-9]{20,}$/.test(value)) return true; // OpenAI keys
    if (/^sk\-ant\-[a-zA-Z0-9_\-]{20,}$/.test(value)) return true; // Anthropic keys
    if (/^gsk_[a-zA-Z0-9_\-]{20,}$/.test(value)) return true; // Groq keys
    if (/^xox[baprs]-[a-zA-Z0-9_\-]{10,}$/.test(value)) return true; // Slack tokens

    return false;
}

/**
 * Sanitize user message to remove secrets before sending to LLM.
 * 1. Pattern-based masking (API keys, passwords, tokens)
 * 2. Entropy heuristic (long random strings)
 * 3. Known vault secrets — in case user accidentally types an actual stored value
 */
export function sanitizeUserMessage(message: string): string {
    let sanitized = message;

    // First pass: mask pattern matches
    for (const pattern of SECRET_PATTERNS) {
        sanitized = sanitized.replace(pattern, (match, group) => {
            if (group) {
                return match.replace(group, MASK);
            }
            return MASK;
        });
    }

    // Second pass: detect and mask suspicious values
    // This catches secrets that don't match known patterns
    const words = sanitized.split(/(\s+)/);
    const maskedWords = words.map(word => {
        const cleanWord = word.replace(/^["']|["']$/g, '');
        if (looksLikeSecret(cleanWord) && !word.includes(MASK)) {
            return word.replace(cleanWord, MASK);
        }
        return word;
    });

    // Third pass: censor any known vault secret values that slipped through
    return censorSecrets(maskedWords.join(''));
}

/**
 * Sanitize messages for display (for activity logging)
 * This is less aggressive - only masks obvious patterns
 */
export function sanitizeForDisplay(message: string): string {
    let sanitized = message;

    // Only mask common patterns
    const displayPatterns = [
        /(api[_-]?key|apikey)["':\s=]+[^\s"']+/gi,
        /(password|passwd|pwd)["':\s=]+[^\s"']+/gi,
        /Bearer\s+[a-zA-Z0-9_\-\.]+/gi,
    ];

    for (const pattern of displayPatterns) {
        sanitized = sanitized.replace(pattern, (_, key) => `${key}: ${MASK}`);
    }

    return sanitized;
}
