// src/config.ts — Config loader
import { readFileSync, existsSync, watch } from "fs";
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
    /** Vision-capable model — for image analysis and OCR. Falls back to balanced. */
    vision?: string;
    /** Summariser model — for LLM-powered content compression. Falls back to fast. */
    summarizer?: string;
    /** Browser agent model — for web browsing tasks (should support vision). Falls back to balanced. */
    browser?: string;
    /** Transcription model — for audio/voice-to-text. Falls back to fast. */
    transcriber?: string;
    /** Text-to-speech model — leave empty to use ElevenLabs provider directly. */
    tts?: string;
}

/** The three primary quality/cost tiers used for general agent calls. */
export type ModelTier = "fast" | "balanced" | "powerful";

export interface LLMConfig {
    /** Active provider key, must match a key in `providers` */
    provider: string;
    /** Active tier: "fast" | "balanced" | "powerful" */
    tier: ModelTier;
    /** Max tokens per response from the LLM. Default: 2000. */
    maxTokens: number;
    /** Max steps per agent turn. Default: 100. */
    maxSteps: number;
    /** XML tag name to extract reasoning from model response. Default: "think". */
    reasoningTag?: string;
    /** Max tokens for LLM-powered summarisation. Default: 1200. */
    llmSummarizeMaxTokens?: number;
    /** Max words per tool result before auto-compressing via LLM. Default: 400. */
    toolResultAutoCompressWords?: number;
    /** Provider configurations — add new providers here */
    providers: {
        [provider: string]: ModelTiers;
    };
}

export interface BrowserAgentConfig {
    /** Max steps the browser sub-agent can take before returning. Default: 25. */
    maxSteps: number;
    /** Max tokens per response from the browser agent LLM. Default: 4096. */
    maxTokens: number;
    /**
     * Optional override for the prompt sent to the vision model after taking a screenshot.
     * Defaults to a built-in prompt that asks for page layout, interactive elements, and positions.
     */
    screenshotPrompt?: string;
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

export interface SelfJobConfig {
    /** Unique job name — used as session key: self-{name} */
    name: string;
    /** Standard 5-field cron expression, e.g. "0 9 * * *" for daily at 9am */
    schedule: string;
    /** Prompt sent to the agent when the job fires */
    message: string;
    /**
     * If true, the job fires exactly once then deletes itself from self-jobs.json
     * and stops its cron task. Use for one-shot reminders ("remind me in 3 hours").
     */
    run_once?: boolean;
    /**
     * Telegram notification config.
     * chatIds: list of Telegram chat IDs (user or group) to send the result to.
     * Use the numeric chat ID from Telegram (positive = user/group, negative = supergroup).
     */
    telegram?: {
        chatIds: number[];
    };
}

export interface ToolDefaults {
    [toolName: string]: Record<string, unknown>;
}

export interface N8nConfig {
    /** n8n base URL — e.g. "http://localhost:5678" or cloud URL */
    baseUrl: string;
    /** Optional: list of allowed workflow names (whitelist). If empty, all workflows can be triggered. */
    workflows?: string[];
}

export interface AppConfig {
    telegram: {
        pollingTimeout: number;
        /** Max tokens to keep in per-chat history before trimming oldest messages */
        historyTokenBudget: number;
        /** @deprecated Owner IDs now stored in encrypted vault as TELEGRAM_OWNER_IDS. Kept for backward compat. */
        ownerUserIds: number[];
        /** Allowed user IDs — can use the agent but not owner-only tools. Empty = everyone allowed. */
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
    /** Self channel — agent-to-self scheduled jobs + HTTP trigger */
    self?: {
        /** Max tokens to keep in each job's history before trimming. Default: 12000. */
        historyTokenBudget: number;
        /**
         * Port for the HTTP trigger server.
         * POST /trigger { prompt, sessionKey?, role? } → runs agent with persistent history.
         * 0 = disabled. Default: 3200.
         */
        httpPort: number;
        /** Cron jobs — can also be defined in .agents/self-jobs.json (gitignored). */
        jobs?: SelfJobConfig[];
    };
    llm: LLMConfig;
    agent: AgentConfig;
    /** Browser sub-agent config — drives browse_task autonomously */
    browserAgent: BrowserAgentConfig;
    browser: {
        /**
         * Run Chromium in visible window mode.
         * false = headless (CI/server). Default: false (show window).
         */
        headless: boolean;
        /**
         * Path to the persistent browser profile directory.
         * Cookies, passwords, localStorage and other state are saved here.
         * Relative paths are resolved from the workspace root.
         * Default: ".agents/browser-profile"
         */
        profileDir: string;
        /**
         * JPEG quality for screenshots sent to the vision LLM (1–100).
         * Lower = smaller base64 payload = fewer tokens consumed per screenshot.
         * Default: 50 (~10-20× fewer tokens vs. full-quality PNG).
         */
        screenshotQuality: number;
        /**
         * Absolute path to a real Chrome/Chromium binary.
         * If set and the file exists, it will be used instead of Playwright's bundled Chromium.
         * Leave empty/unset in Docker/CI — bundled Chromium will be used automatically.
         * Mac default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
         */
        chromePath?: string;
        /** Extra Chromium launch args appended to the default set. */
        extraArgs?: string[];
        /** Viewport dimensions. Default: { width: 1280, height: 800 }. */
        viewport?: { width: number; height: number };
        /** Browser user-agent string override. */
        userAgent?: string;
        /** Browser locale, e.g. "en-US". Default: "en-US". */
        locale?: string;
        /** Timezone ID, e.g. "Asia/Kolkata". Default: "Asia/Kolkata". */
        timezone?: string;
        /** Extra Playwright BrowserContext options spread in last (overrides all above). */
        context?: Record<string, unknown>;
    };
    /** Default arguments to inject when calling specific tools */
    toolDefaults?: ToolDefaults;
    /** Agent Skills configuration */
    skills?: {
        /**
         * Directories to scan for SKILL.md files.
         * Relative paths are resolved from the project root.
         * Default: [".agents/skills", "src/skills/built-in"]
         */
        dirs?: string[];
    };
    /** n8n integration — for triggering workflows */
    n8n?: N8nConfig;
    /** Embedding config for semantic history search */
    embeddings?: {
        /** Enable/disable the embedding system. Default: true. */
        enabled: boolean;
        /** Provider for embeddings: "openrouter" or "google". */
        provider: "openrouter" | "google";
        /** Embedding model ID (provider-specific). */
        model: string;
        /** Number of top results to return from search. Default: 5. */
        topK: number;
        /** Max tokens per chunk text before truncation. Default: 500. */
        chunkMaxTokens: number;
    };
}

let _config: AppConfig | null = null;

/** Path to the gitignored auth override file */
const AUTH_FILE = resolve(__dirname, "..", ".agents", "auth.json");

// ── Hot-reload: watch forkscout.config.json and auth.json for changes ────────
// Clears the in-memory cache so the next getConfig() call re-reads from disk.
// Works in production (bun start) — no restart needed for config changes.
const CONFIG_PATH = resolve(__dirname, "forkscout.config.json");
function startConfigWatcher(): void {
    const invalidate = (filename: string | null) => {
        if (!_config) return; // already cleared
        _config = null;
        console.log(`[config] hot-reload: ${filename ?? "config"} changed — cache cleared`);
    };
    try { watch(CONFIG_PATH, { persistent: false }, (_, f) => invalidate(f)); } catch { /* ignore */ }
    try { watch(AUTH_FILE, { persistent: false }, (_, f) => invalidate(f)); } catch { /* ignore if not exists */ }
}
startConfigWatcher();

export function loadConfig(): AppConfig {
    if (_config) return _config;

    const configPath = resolve(__dirname, "forkscout.config.json");
    const raw = readFileSync(configPath, "utf-8");
    let config = JSON.parse(raw) as AppConfig;

    // Default ownerUserIds to [] (now stored in vault, not config)
    if (!config.telegram.ownerUserIds) config.telegram.ownerUserIds = [];

    // Merge .agents/auth.json if it exists (gitignored — safe for secrets)
    if (existsSync(AUTH_FILE)) {
        const authRaw = readFileSync(AUTH_FILE, "utf-8");
        config = deepMerge(config, JSON.parse(authRaw) as Partial<AppConfig>);
    }

    // Apply environment variable overrides (useful in Docker/CI)
    // BROWSER_HEADLESS=true → forces headless regardless of JSON config
    if (process.env.BROWSER_HEADLESS === "true") {
        config.browser.headless = true;
        config.browser.chromePath = undefined; // Docker has no real Chrome
    }

    _config = config;
    return _config;
}

export function getConfig(): AppConfig {
    if (!_config) return loadConfig();
    return _config;
}
