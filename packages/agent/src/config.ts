/**
 * Forkscout Config — loads forkscout.config.json + .env secrets.
 *
 * Config file (committed):  forkscout.config.json — models, tiers, budget, agent settings
 * Secrets file (gitignored): .env — API keys, tokens, passwords
 *
 * The config loader:
 *   1. Reads forkscout.config.json from project root
 *   2. Reads .env for secrets (via dotenv, already loaded by serve.ts/cli.ts)
 *   3. Merges into a typed ForkscoutConfig object
 *   4. Env vars can still override any config value (backward compat)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Types ──────────────────────────────────────────────

export type ProviderType = 'openrouter' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'openai-compatible';

export interface TierConfig {
    model: string;
    provider?: ProviderType;
    baseURL?: string;
}

export interface RouterConfig {
    fast: TierConfig;
    balanced: TierConfig;
    powerful: TierConfig;
}

export interface BudgetConfig {
    dailyUSD: number;
    monthlyUSD: number;
    warningPct: number;
}

export interface AgentSettings {
    maxIterations: number;
    autoRegisterTools: boolean;
    port: number;
}

export interface SearxngConfig {
    url: string;
}

export interface ForkscoutConfig {
    /** Default LLM provider */
    provider: ProviderType;
    /** Default model ID */
    model: string;
    /** Default base URL */
    baseURL: string;
    /** Sampling temperature */
    temperature: number;
    /** Max tokens per response */
    maxTokens: number;

    /** Multi-model router tiers */
    router: RouterConfig;

    /** Budget limits */
    budget: BudgetConfig;

    /** Agent settings */
    agent: AgentSettings;

    /** SearXNG web search */
    searxng: SearxngConfig;

    // ── Secrets (resolved from .env, never in config file) ──
    secrets: {
        openrouterApiKey: string;
        openaiApiKey: string;
        anthropicApiKey: string;
        googleApiKey: string;
        adminSecret: string;
        telegramBotToken: string;
    };
}

// ── Defaults ───────────────────────────────────────────

const DEFAULTS: Omit<ForkscoutConfig, 'secrets'> = {
    provider: 'openrouter',
    model: 'x-ai/grok-4.1-fast',
    baseURL: 'https://openrouter.ai/api/v1',
    temperature: 0.7,
    maxTokens: 2000,
    router: {
        fast: { model: 'google/gemini-2.0-flash-001', provider: 'openrouter' },
        balanced: { model: 'x-ai/grok-4.1-fast', provider: 'openrouter' },
        powerful: { model: 'anthropic/claude-sonnet-4', provider: 'openrouter' },
    },
    budget: { dailyUSD: 5, monthlyUSD: 50, warningPct: 80 },
    agent: { maxIterations: 10, autoRegisterTools: true, port: 3210 },
    searxng: { url: 'http://localhost:8888' },
};

// ── Provider → base URL mapping ────────────────────────

const PROVIDER_URLS: Record<string, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    openai: 'https://api.openai.com/v1',
    ollama: 'http://localhost:11434/v1',
};

// ── Loader ─────────────────────────────────────────────

/** Singleton config instance */
let _config: ForkscoutConfig | null = null;

/**
 * Load the Forkscout config. Reads the file once and caches.
 * Call with `force: true` to reload.
 */
export function loadConfig(force = false): ForkscoutConfig {
    if (_config && !force) return _config;

    // 1. Read config file
    const configPath = findConfigFile();
    let fileConfig: any = {};
    if (configPath) {
        try {
            const raw = readFileSync(configPath, 'utf-8');
            fileConfig = JSON.parse(raw);
            // Strip $schema key if present
            delete fileConfig.$schema;
        } catch (e: any) {
            console.warn(`[Config] Failed to parse ${configPath}: ${e.message}`);
        }
    }

    // 2. Build config: file values → env overrides → defaults
    const provider = resolveProvider(
        env('MODEL_PROVIDER') || env('LLM_PROVIDER') || fileConfig.provider || DEFAULTS.provider
    );

    const baseURL = env('LLM_BASE_URL')
        || fileConfig.baseURL
        || PROVIDER_URLS[provider]
        || DEFAULTS.baseURL;

    const config: ForkscoutConfig = {
        provider,
        model: env('LLM_MODEL') || fileConfig.model || DEFAULTS.model,
        baseURL,
        temperature: floatEnv('LLM_TEMPERATURE') ?? fileConfig.temperature ?? DEFAULTS.temperature,
        maxTokens: intEnv('LLM_MAX_TOKENS') ?? fileConfig.maxTokens ?? DEFAULTS.maxTokens,

        router: buildRouterConfig(fileConfig.router, provider, baseURL),
        budget: buildBudgetConfig(fileConfig.budget),
        agent: buildAgentConfig(fileConfig.agent),
        searxng: {
            url: env('SEARXNG_URL') || fileConfig.searxng?.url || DEFAULTS.searxng.url,
        },

        secrets: {
            openrouterApiKey: env('OPENROUTER_API_KEY') || '',
            openaiApiKey: env('OPENAI_API_KEY') || '',
            anthropicApiKey: env('ANTHROPIC_API_KEY') || '',
            googleApiKey: env('GOOGLE_API_KEY') || '',
            adminSecret: env('ADMIN_SECRET') || '',
            telegramBotToken: env('TELEGRAM_BOT_TOKEN') || '',
        },
    };

    _config = config;
    return config;
}

/** Get the cached config (throws if not loaded yet) */
export function getConfig(): ForkscoutConfig {
    if (!_config) return loadConfig();
    return _config;
}

/**
 * Resolve the API key for a given provider type.
 * Priority: provider-specific env var → LLM_API_KEY → empty
 */
export function resolveApiKeyForProvider(provider: ProviderType, cfg?: ForkscoutConfig): string {
    const c = cfg || getConfig();
    const map: Record<ProviderType, string> = {
        openrouter: c.secrets.openrouterApiKey,
        openai: c.secrets.openaiApiKey,
        anthropic: c.secrets.anthropicApiKey,
        google: c.secrets.googleApiKey,
        ollama: '',
        'openai-compatible': '',
    };

    // Provider-specific key first
    const key = map[provider];
    if (key) return key;

    // Fallback: LLM_API_KEY or any available key
    return env('LLM_API_KEY')
        || c.secrets.openrouterApiKey
        || c.secrets.openaiApiKey
        || c.secrets.anthropicApiKey
        || c.secrets.googleApiKey
        || '';
}

// ── Builder helpers ────────────────────────────────────

function buildRouterConfig(file: any, globalProvider: ProviderType, _globalBaseURL: string): RouterConfig {
    const fileFast = file?.fast || {};
    const fileBalanced = file?.balanced || {};
    const filePowerful = file?.powerful || {};

    return {
        fast: {
            model: env('MODEL_FAST') || fileFast.model || DEFAULTS.router.fast.model,
            provider: resolveProvider(env('MODEL_FAST_PROVIDER') || fileFast.provider || globalProvider),
            baseURL: env('MODEL_FAST_BASE_URL') || fileFast.baseURL,
        },
        balanced: {
            model: env('MODEL_BALANCED') || fileBalanced.model || DEFAULTS.router.balanced.model,
            provider: resolveProvider(env('MODEL_BALANCED_PROVIDER') || fileBalanced.provider || globalProvider),
            baseURL: env('MODEL_BALANCED_BASE_URL') || fileBalanced.baseURL,
        },
        powerful: {
            model: env('MODEL_POWERFUL') || filePowerful.model || DEFAULTS.router.powerful.model,
            provider: resolveProvider(env('MODEL_POWERFUL_PROVIDER') || filePowerful.provider || globalProvider),
            baseURL: env('MODEL_POWERFUL_BASE_URL') || filePowerful.baseURL,
        },
    };
}

function buildBudgetConfig(file: any): BudgetConfig {
    return {
        dailyUSD: floatEnv('BUDGET_DAILY_USD') ?? file?.dailyUSD ?? DEFAULTS.budget.dailyUSD,
        monthlyUSD: floatEnv('BUDGET_MONTHLY_USD') ?? file?.monthlyUSD ?? DEFAULTS.budget.monthlyUSD,
        warningPct: floatEnv('BUDGET_WARNING_PCT') ?? file?.warningPct ?? DEFAULTS.budget.warningPct,
    };
}

function buildAgentConfig(file: any): AgentSettings {
    return {
        maxIterations: intEnv('AGENT_MAX_ITERATIONS') ?? file?.maxIterations ?? DEFAULTS.agent.maxIterations,
        autoRegisterTools: env('AGENT_AUTO_REGISTER_TOOLS') !== undefined
            ? env('AGENT_AUTO_REGISTER_TOOLS') !== 'false'
            : file?.autoRegisterTools ?? DEFAULTS.agent.autoRegisterTools,
        port: intEnv('AGENT_PORT') ?? file?.port ?? DEFAULTS.agent.port,
    };
}

// ── Utilities ──────────────────────────────────────────

function findConfigFile(): string | null {
    // Search from cwd upward, then project root
    const candidates = [
        resolve(process.cwd(), 'forkscout.config.json'),
        resolve(__dirname, '../../../../forkscout.config.json'),  // packages/agent/src → root
        resolve(__dirname, '../../../forkscout.config.json'),     // if in dist/
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return null;
}

function resolveProvider(raw: string): ProviderType {
    const lc = (raw || '').toLowerCase().trim();
    switch (lc) {
        case 'openrouter': return 'openrouter';
        case 'openai': return 'openai';
        case 'anthropic': return 'anthropic';
        case 'google': case 'google-ai': case 'gemini': return 'google';
        case 'ollama': return 'ollama';
        case 'openai-compatible': case 'custom': return 'openai-compatible';
        default: return 'openrouter';
    }
}

function env(key: string): string | undefined {
    const val = process.env[key];
    return val && val.trim() !== '' ? val.trim() : undefined;
}

function intEnv(key: string): number | undefined {
    const v = env(key);
    if (v === undefined) return undefined;
    const n = parseInt(v, 10);
    return isNaN(n) ? undefined : n;
}

function floatEnv(key: string): number | undefined {
    const v = env(key);
    if (v === undefined) return undefined;
    const n = parseFloat(v);
    return isNaN(n) ? undefined : n;
}
