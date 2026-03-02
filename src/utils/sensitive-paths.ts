// src/utils/sensitive-paths.ts — Centralized sensitive-path detection for all tools.
// Single source of truth: every tool that touches the filesystem must use this module.
// To add a new sensitive path, update ONLY this file — all tools pick up the change.

import { basename, resolve } from "path";

// ────────────────────────────────────────────
// 1. Sensitive file basenames (regex on basename)
// ────────────────────────────────────────────
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
    // Environment / dotenv
    /^\.env$/i,
    /^\.env\..+$/i,

    // Vault / auth
    /^vault\.enc\.json$/i,
    /^vault\.json$/i,
    /^auth\.json$/i,

    // SSH / TLS keys
    /\.pem$/i,
    /\.key$/i,
    /^id_rsa/i,
    /^id_ed25519/i,
    /\.secret$/i,

    // WhatsApp / Baileys session credentials
    /^creds\.json$/i,
    /^pre-key-.*\.json$/i,
    /^session-.*\.json$/i,
    /^sender-key-.*\.json$/i,
    /^app-state-sync-key-.*\.json$/i,
];

// ────────────────────────────────────────────
// 2. Sensitive directory segments (match against resolved path)
// ────────────────────────────────────────────
const SENSITIVE_DIR_PATTERNS: RegExp[] = [
    /whatsapp-sessions/i,
    /\.ssh\//i,
];

// ────────────────────────────────────────────
// 3. Sensitive path substrings for shell command scanning
//    Used to detect REFERENCES to sensitive paths inside arbitrary commands.
// ────────────────────────────────────────────
const SENSITIVE_PATH_KEYWORDS: string[] = [
    ".env",
    "vault.enc",
    "vault.json",
    "auth.json",
    "creds.json",
    "whatsapp-sessions",
    "id_rsa",
    "id_ed25519",
    ".pem",
    ".secret",
    "pre-key-",
    "session-",         // Will match "whatsapp-sessions" too — that's fine
    "sender-key-",
    "app-state-sync-key-",
];

// ────────────────────────────────────────────
// 4. Environment-leak patterns for shell commands
// ────────────────────────────────────────────
const ENV_LEAK_PATTERNS: RegExp[] = [
    /\bprintenv\b/i,
    /\benv\b\s*$/i,
    /\benv\b\s*\|/i,
    /\bset\b\s*\|.*grep.*KEY/i,
    /echo\s+\$\w*(KEY|SECRET|TOKEN|PASSWORD|VAULT|API)/i,
    /\bexport\b\s*\|.*grep.*(KEY|SECRET|TOKEN)/i,
];

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Check if a file path points to a sensitive file.
 * Works on both basenames and full/relative paths.
 */
export function isSensitivePath(filePath: string): boolean {
    const name = basename(filePath);
    if (SENSITIVE_FILE_PATTERNS.some((p) => p.test(name))) return true;
    const resolved = resolve(filePath);
    if (SENSITIVE_DIR_PATTERNS.some((p) => p.test(resolved))) return true;
    return false;
}

/**
 * Check if a directory path is sensitive (should not be listed / traversed).
 */
export function isSensitiveDir(dirPath: string): boolean {
    const resolved = resolve(dirPath);
    return SENSITIVE_DIR_PATTERNS.some((p) => p.test(resolved));
}

/**
 * Check if a shell command references any sensitive path or tries to leak env vars.
 * This is path-based — it catches `cat`, `cp`, `base64`, `curl -d@`, `python -c open(...)`,
 * or ANY command that names a sensitive file/dir, regardless of the binary used.
 */
export function commandTouchesSensitivePath(cmd: string): boolean {
    const lower = cmd.toLowerCase();

    // Check if command references any sensitive path keyword
    if (SENSITIVE_PATH_KEYWORDS.some((kw) => lower.includes(kw))) return true;

    // Check for env-variable leak patterns
    if (ENV_LEAK_PATTERNS.some((p) => p.test(cmd))) return true;

    return false;
}

/** Human-readable reason string for blocked access */
export const SENSITIVE_PATH_BLOCKED_MSG =
    "BLOCKED: This path contains sensitive credentials (secrets, keys, WhatsApp session). " +
    "Use the secret_vault tool to manage secrets safely.";

export const SENSITIVE_CMD_BLOCKED_MSG =
    "BLOCKED: This command references sensitive files or environment variables. " +
    "Use the secret_vault tool to manage secrets safely.";
