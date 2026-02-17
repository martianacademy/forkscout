/**
 * Shared internal helpers for tool implementations.
 * Secret scrubbing, template resolution, and path protection.
 */

// ─── Secret Management ──────────────────────────────────

/** Env var name patterns considered sensitive (never expose values) */
const SECRET_PATTERNS = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PRIVATE/i;

/** Get all env var names that match sensitive patterns */
export function getSecretNames(): string[] {
    return Object.keys(process.env).filter(k => SECRET_PATTERNS.test(k));
}

/** Build a value→placeholder map for scrubbing output */
function buildScrubMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const key of getSecretNames()) {
        const val = process.env[key];
        if (val && val.length >= 6) { // don't scrub very short values (too many false positives)
            map.set(val, `[REDACTED:${key}]`);
        }
    }
    return map;
}

/** Scrub all known secret values from a string */
export function scrubSecrets(text: string): string {
    const map = buildScrubMap();
    let result = text;
    // Sort by value length descending to replace longest matches first
    const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [secret, placeholder] of entries) {
        while (result.includes(secret)) {
            result = result.replace(secret, placeholder);
        }
    }
    return result;
}

/** Resolve {{SECRET_NAME}} templates in a string (returns resolved string, never exposed to LLM) */
export function resolveTemplates(text: string): string {
    return text.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (_match, name) => {
        const val = process.env[name];
        if (!val) throw new Error(`Secret {{${name}}} is not set in environment`);
        return val;
    });
}

// ─── Path Protection ────────────────────────────────────

/** Paths the agent must never delete — memory data and agent source */
const PROTECTED_PATTERNS = [
    /\.forkscout\//,           // memory files (graph, vectors, skills)
    /\.forkscout$/,            // the .forkscout dir itself
    /packages\/agent\/src\//,  // agent source (use safe_self_edit instead)
    /\.env/,                   // secrets
    /\.git\//,                 // git internals
];

export function isProtectedPath(absPath: string): string | null {
    if (PROTECTED_PATTERNS.some(p => p.test(absPath))) {
        if (/\.forkscout/.test(absPath)) return `🛡️ Refused: "${absPath}" contains memory data. I will not delete my own memory.`;
        if (/packages\/agent\/src/.test(absPath)) return `🛡️ Refused: "${absPath}" is agent source code. Use safe_self_edit to modify it.`;
        if (/\.env/.test(absPath)) return `🛡️ Refused: "${absPath}" contains secrets.`;
        if (/\.git/.test(absPath)) return `🛡️ Refused: "${absPath}" is git history.`;
        return `🛡️ Refused: "${absPath}" is protected.`;
    }
    return null;
}
