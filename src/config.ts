// src/config.ts — Config loader
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Deep-merge source into target (objects only, arrays replaced not merged) */
function deepMerge<T>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
        const s = source[key];
        const t = target[key];
        if (s !== undefined) {
            (result as any)[key] =
                s !== null && typeof s === "object" && !Array.isArray(s) && typeof t === "object" && t !== null
                    ? deepMerge(t, s as any)
                    : s;
        }
    }
    return result;
}

export interface ModelTiers {
    /** Cheapest + fastest — good for simple tasks */
    fast: string;
    /** Speed/quality balance — default */
    balanced: string;
    /** Best quality — for complex reasoning tasks */
    powerful: string;
}

export type ModelTier = keyof ModelTiers;

export interface LLMConfig {
    /** Active provider key, must match a key in `providers` */
    provider: string;
    /** Active tier: "fast" | "balanced" | "powerful" */
    tier: ModelTier;
    /** Per-provider model tiers. Model IDs are relative (no provider prefix). */
    providers: Record<string, ModelTiers>;
    maxTokens: number;
    maxSteps: number;
    /** Max output tokens for LLM summarisation calls (compress_text mode='llm'). Default: 1200. */
    llmSummarizeMaxTokens: number;
    /**
     * Word count threshold for auto-compressing tool results before they enter the LLM context.
     * Results under this size pass through as-is. Default: 400.
     * ≤ 400 words  → no compression
     * 400–2000     → extractive (instant, free)
     * > 2000       → LLM synthesis (fast tier)
     */
    toolResultAutoCompressWords: number;
}

export interface AgentConfig {
    /** Display name of the agent */
    name: string;
    /** Short description used in system prompts and headers */
    description?: string;
    /** GitHub URL for HTTP-Referer headers and identity */
    github: string;
    /** Optional extra instructions appended after the base identity prompt */
    systemPromptExtra?: string;
}

export interface ToolDefaults {
    [toolName: string]: Record<string, unknown>;
}

export interface AppConfig {
    telegram: {
        pollingTimeout: number;
        /** Max tokens to keep in per-chat history before trimming oldest messages */
        historyTokenBudget: number;
        /** Owner user IDs — full access including shell tools. Empty = dev mode (allow all as owner). */
        ownerUserIds: number[];
        /** Allowed user IDs — agent access only, no owner-only tools. */
        allowedUserIds: number[];
        /** Max messages per user per minute before rate-limiting. 0 = disabled. */
        rateLimitPerMinute: number;
        /** Max input length in characters. Messages longer than this are rejected. 0 = disabled. */
        maxInputLength: number;
        /** Tool names restricted to owners only. Users with allowedUserIds cannot trigger these. */
        ownerOnlyTools: string[];
        /** Max tokens a single tool result may occupy in history. Larger results are truncated. Default: 3000. */
        maxToolResultTokens: number;
        /** Max sentences to keep when compressing an oversized tool result via extractive summarisation. Default: 20. */
        maxSentencesPerToolResult: number;
    };
    terminal: {
        /** Max tokens to keep in terminal session history before trimming oldest messages */
        historyTokenBudget: number;
    };
    llm: LLMConfig;
    agent: AgentConfig;
    /** Default arguments to inject when calling specific tools */
    toolDefaults?: ToolDefaults;
}

let _config: AppConfig | null = null;

/** Path to the gitignored auth override file */
const AUTH_FILE = resolve(__dirname, "..", ".forkscout", "auth.json");

export function loadConfig(): AppConfig {
    if (_config) return _config;

    const configPath = resolve(__dirname, "forkscout.config.json");
    const raw = readFileSync(configPath, "utf-8");
    let config = JSON.parse(raw) as AppConfig;

    // Merge .forkscout/auth.json if it exists (gitignored — safe for secrets)
    if (existsSync(AUTH_FILE)) {
        const authRaw = readFileSync(AUTH_FILE, "utf-8");
        config = deepMerge(config, JSON.parse(authRaw) as Partial<AppConfig>);
    }

    _config = config;
    return _config;
}

export function getConfig(): AppConfig {
    if (!_config) return loadConfig();
    return _config;
}