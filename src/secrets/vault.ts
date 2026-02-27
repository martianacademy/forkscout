// src/secrets/vault.ts — Named secret vault. Secrets stored encrypted on disk,
// NEVER passed to the LLM. Agent uses {{secret:alias}} placeholders everywhere.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VAULT_FILE = resolve(ROOT, ".agents", "vault.enc.json");
const ALIAS_PATTERN = /\{\{secret:([a-zA-Z0-9_\-]+)\}\}/g;
const CENSOR_PLACEHOLDER = (alias: string) => `[SECRET:${alias}]`;

// ── Key derivation ──────────────────────────────────────────────────────────
// Key = SHA-256 of VAULT_KEY env var (or bot token as fallback).
// If neither is set, warn and use a fixed key (insecure — only for dev).

function deriveKey(): Buffer {
    const raw =
        process.env.VAULT_KEY ||
        process.env.TELEGRAM_BOT_TOKEN ||
        "forkscout-insecure-dev-key-set-VAULT_KEY-in-env";
    return createHash("sha256").update(raw).digest();
}

// ── Encrypted vault format ──────────────────────────────────────────────────

interface EncryptedEntry {
    iv: string;    // hex
    tag: string;   // hex (GCM auth tag)
    data: string;  // hex (ciphertext)
}

type VaultFile = Record<string, EncryptedEntry>;

// ── Encrypt / decrypt helpers ───────────────────────────────────────────────

function encrypt(plaintext: string, key: Buffer): EncryptedEntry {
    const iv = randomBytes(12); // 96-bit for GCM
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv: iv.toString("hex"), tag: tag.toString("hex"), data: data.toString("hex") };
}

function decrypt(entry: EncryptedEntry, key: Buffer): string {
    const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(entry.iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
    return Buffer.concat([
        decipher.update(Buffer.from(entry.data, "hex")),
        decipher.final(),
    ]).toString("utf-8");
}

// ── Load / save vault ───────────────────────────────────────────────────────

function loadVault(): VaultFile {
    if (!existsSync(VAULT_FILE)) return {};
    try {
        return JSON.parse(readFileSync(VAULT_FILE, "utf-8")) as VaultFile;
    } catch {
        return {};
    }
}

function saveVault(vault: VaultFile): void {
    const dir = dirname(VAULT_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), "utf-8");
}

// ── In-memory alias→value cache (populated lazily, cleared on write) ────────
// Used only by censorSecrets() for reverse lookup — actual values never logged.

let _secretCache: Map<string, string> | null = null;

function getCache(): Map<string, string> {
    if (_secretCache) return _secretCache;
    const key = deriveKey();
    const vault = loadVault();
    _secretCache = new Map();
    for (const [alias, entry] of Object.entries(vault)) {
        try {
            _secretCache.set(alias, decrypt(entry, key));
        } catch {
            // corrupted entry — skip
        }
    }
    return _secretCache;
}

function invalidateCache(): void {
    _secretCache = null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Store an alias → value. Encrypts before writing to disk. */
export function setSecret(alias: string, value: string): void {
    const key = deriveKey();
    const vault = loadVault();
    vault[alias] = encrypt(value, key);
    saveVault(vault);
    invalidateCache();
}

/** Retrieve a secret value by alias. Returns null if not found. */
export function getSecret(alias: string): string | null {
    const cache = getCache();
    return cache.get(alias) ?? null;
}

/** List alias names only — values are never returned here. */
export function listAliases(): string[] {
    return Object.keys(loadVault());
}

/** Delete an alias from the vault. */
export function deleteSecret(alias: string): boolean {
    const vault = loadVault();
    if (!(alias in vault)) return false;
    delete vault[alias];
    saveVault(vault);
    invalidateCache();
    return true;
}

/**
 * Replace every {{secret:alias}} placeholder in a string with its actual value.
 * Used INSIDE tools at execution time — never before sending to LLM.
 */
export function resolveSecrets(str: string): string {
    return str.replace(ALIAS_PATTERN, (_, alias) => {
        const val = getSecret(alias);
        if (val === null) throw new Error(`Secret alias not found: ${alias}`);
        return val;
    });
}

/**
 * Replace every known secret VALUE in a string with [SECRET:alias].
 * Use on tool outputs before returning to LLM, and on messages before logging.
 * This prevents values that leaked into output from propagating further.
 */
export function censorSecrets(str: string): string {
    const cache = getCache();
    if (cache.size === 0) return str;
    let censored = str;
    for (const [alias, value] of cache.entries()) {
        if (value.length < 4) continue; // skip suspiciously short values
        censored = censored.split(value).join(CENSOR_PLACEHOLDER(alias));
    }
    return censored;
}

/**
 * Check whether a string contains any {{secret:alias}} placeholders.
 */
export function hasSecretPlaceholders(str: string): boolean {
    ALIAS_PATTERN.lastIndex = 0;
    return ALIAS_PATTERN.test(str);
}

/**
 * Populate process.env from vault secrets.
 * Called at boot so LLM providers and tools that read process.env still work,
 * while the actual secrets live only in the encrypted vault (not .env on disk).
 * Returns the number of env vars populated.
 */
export function populateEnvFromVault(): number {
    const cache = getCache();
    let count = 0;
    for (const [alias, value] of cache.entries()) {
        process.env[alias] = value;
        count++;
    }
    return count;
}
