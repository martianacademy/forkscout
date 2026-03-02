// src/utils/redact.ts — Output sanitizer: strips sensitive-looking data from any text/object.
// Import `redactOutput` in tool pipelines to scrub results before the LLM sees them.
// This is a LAST-LINE defense — path-based guards in sensitive-paths.ts are the first line.

// ────────────────────────────────────────────
// Redaction rules — ordered from most-specific to least-specific.
// Each rule has a regex and a replacement string.
// ────────────────────────────────────────────

interface RedactionRule {
    /** Human-readable label (for debugging, not shown to users) */
    label: string;
    pattern: RegExp;
    replacement: string | ((match: string) => string);
}

const RULES: RedactionRule[] = [
    // ── PEM private key blocks ──────────────────────────────────
    {
        label: "PEM private key",
        pattern: /-----BEGIN\s[\w\s]*PRIVATE KEY-----[\s\S]*?-----END\s[\w\s]*PRIVATE KEY-----/g,
        replacement: "[REDACTED:private-key]",
    },

    // ── Known API key prefixes (high confidence) ────────────────
    {
        label: "OpenAI key",
        pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g,
        replacement: "[REDACTED:api-key]",
    },
    {
        label: "Anthropic key",
        pattern: /\bsk-ant-[a-zA-Z0-9\-]{20,}\b/g,
        replacement: "[REDACTED:api-key]",
    },
    {
        label: "xAI key",
        pattern: /\bxai-[a-zA-Z0-9]{20,}\b/g,
        replacement: "[REDACTED:api-key]",
    },
    {
        label: "Groq key",
        pattern: /\bgsk_[a-zA-Z0-9]{20,}\b/g,
        replacement: "[REDACTED:api-key]",
    },
    {
        label: "HuggingFace key",
        pattern: /\bhf_[a-zA-Z0-9]{20,}\b/g,
        replacement: "[REDACTED:api-key]",
    },
    {
        label: "Replicate key",
        pattern: /\br8_[a-zA-Z0-9]{20,}\b/g,
        replacement: "[REDACTED:api-key]",
    },
    {
        label: "Perplexity key",
        pattern: /\bpplx-[a-zA-Z0-9]{20,}\b/g,
        replacement: "[REDACTED:api-key]",
    },
    {
        label: "AWS access key",
        pattern: /\bAKIA[A-Z0-9]{16}\b/g,
        replacement: "[REDACTED:aws-key]",
    },
    {
        label: "GitHub token",
        pattern: /\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}\b/g,
        replacement: "[REDACTED:github-token]",
    },
    {
        label: "Telegram bot token",
        pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
        replacement: "[REDACTED:telegram-token]",
    },

    // ── JWT tokens (three base64url segments) ───────────────────
    {
        label: "JWT",
        pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
        replacement: "[REDACTED:jwt]",
    },

    // ── Bearer / Authorization header values ────────────────────
    {
        label: "Bearer token",
        pattern: /\b(Bearer|Authorization[:\s]+Bearer)\s+[a-zA-Z0-9._\-]{20,}\b/gi,
        replacement: "[REDACTED:bearer-token]",
    },

    // ── JSON fields with sensitive key names ────────────────────
    // Catches: "password": "value", "secret": "value", etc.
    {
        label: "JSON sensitive field",
        pattern: /"(password|secret|token|api_?key|apiKey|private_?key|privateKey|access_?token|accessToken|refresh_?token|refreshToken|client_?secret|clientSecret|auth_?token|authToken|session_?secret|sessionSecret|encryption_?key|encryptionKey|signing_?key|signingKey|creds|credentials|noiseKey|signedIdentityKey|signedPreKey|registrationId|advSecretKey|me|account)"\s*:\s*"[^"]{3,}"/gi,
        replacement: (match) => {
            // Preserve the key name but redact the value
            const keyMatch = match.match(/^"([^"]+)"/);
            const key = keyMatch ? keyMatch[1] : "field";
            return `"${key}": "[REDACTED]"`;
        },
    },
    // Also catch JSON sensitive fields with non-string values (objects, arrays, numbers)
    {
        label: "JSON sensitive field (object/array value)",
        pattern: /"(noiseKey|signedIdentityKey|signedPreKey|advSecretKey|registrationId|me|account)"\s*:\s*(\{[^}]*\}|\[[^\]]*\]|\d+)/gi,
        replacement: (match) => {
            const keyMatch = match.match(/^"([^"]+)"/);
            const key = keyMatch ? keyMatch[1] : "field";
            return `"${key}": "[REDACTED]"`;
        },
    },

    // ── Environment variable assignments with sensitive names ───
    {
        label: "Env var assignment",
        pattern: /\b([\w]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE)[\w]*)\s*=\s*['"]?[^\s'"]{8,}['"]?/gi,
        replacement: "$1=[REDACTED]",
    },

    // ── Long hex strings (64+ chars — likely SHA-256, encryption keys) ──
    // Skips git SHAs (40 chars) and shorter hashes
    {
        label: "Long hex string",
        pattern: /\b[0-9a-f]{64,}\b/gi,
        replacement: "[REDACTED:hex-key]",
    },

    // ── Base64-encoded blobs ≥ 80 chars (likely encoded keys/certs) ──
    // Only matches pure base64 strings, not normal text
    {
        label: "Long base64 blob",
        pattern: /\b[A-Za-z0-9+/]{80,}={0,3}\b/g,
        replacement: "[REDACTED:encoded-data]",
    },
];

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Redact sensitive-looking content from a string.
 * Returns the string with secrets replaced by `[REDACTED:type]` placeholders.
 */
export function redact(text: string): string {
    if (!text || typeof text !== "string") return text;
    let result = text;
    for (const rule of RULES) {
        if (typeof rule.replacement === "function") {
            result = result.replace(rule.pattern, rule.replacement);
        } else {
            result = result.replace(rule.pattern, rule.replacement);
        }
    }
    return result;
}

/**
 * Deep-walk an object/array and redact all string values.
 * Returns a new object (does not mutate the original).
 * Non-string primitives (numbers, booleans, null) pass through unchanged.
 */
export function redactOutput<T>(output: T): T {
    if (output === null || output === undefined) return output;

    if (typeof output === "string") {
        return redact(output) as T;
    }

    if (Array.isArray(output)) {
        return output.map((item) => redactOutput(item)) as T;
    }

    if (typeof output === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
            result[key] = redactOutput(value);
        }
        return result as T;
    }

    // Primitives (number, boolean) — pass through
    return output;
}
