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
        openrouterApiUrl: string;
        openaiApiKey: string;
        openaiApiUrl: string;
        anthropicApiKey: string;
        anthropicApiUrl: string;
        googleApiKey: string;
        googleApiUrl: string;
        openApiCompatibleApiKey: string;
        openApiCompatibleApiUrl: string;
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
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
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
    //    Only DEFAULT_PROVIDER and DEFAULT_MODEL can be overridden via env.
    //    Everything else lives in forkscout.config.json.
    const provider = resolveProvider(
        env('DEFAULT_PROVIDER') || fileConfig.provider || DEFAULTS.provider
    );

    const baseURL = resolveProviderUrl(provider)
        || fileConfig.baseURL
        || PROVIDER_URLS[provider]
        || DEFAULTS.baseURL;

    const config: ForkscoutConfig = {
        provider,
        model: env('DEFAULT_MODEL') || fileConfig.model || DEFAULTS.model,
        baseURL,
        temperature: fileConfig.temperature ?? DEFAULTS.temperature,
        maxTokens: fileConfig.maxTokens ?? DEFAULTS.maxTokens,

        router: buildRouterConfig(fileConfig.router, provider, baseURL),
        budget: buildBudgetConfig(fileConfig.budget),
        agent: buildAgentConfig(fileConfig.agent),
        searxng: {
            url: env('SEARXNG_URL') || fileConfig.searxng?.url || DEFAULTS.searxng.url,
        },

        secrets: {
            openrouterApiKey: env('OPENROUTER_API_KEY') || '',
            openrouterApiUrl: env('OPENROUTER_API_URL') || PROVIDER_URLS.openrouter,
            openaiApiKey: env('OPENAI_API_KEY') || '',
            openaiApiUrl: env('OPENAI_API_URL') || PROVIDER_URLS.openai,
            anthropicApiKey: env('ANTHROPIC_API_KEY') || '',
            anthropicApiUrl: env('ANTHROPIC_API_URL') || PROVIDER_URLS.anthropic,
            googleApiKey: env('GOOGLE_API_KEY') || '',
            googleApiUrl: env('GOOGLE_API_URL') || PROVIDER_URLS.google,
            openApiCompatibleApiKey: env('OPEN_API_COMPATIBLE_API_KEY') || '',
            openApiCompatibleApiUrl: env('OPEN_API_COMPATIBLE_API_URL') || '',
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
        'openai-compatible': c.secrets.openApiCompatibleApiKey,
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

/**
 * Resolve the API URL for a given provider type.
 * Priority: provider-specific env URL → PROVIDER_URLS default
 */
export function resolveApiUrlForProvider(provider: ProviderType, cfg?: ForkscoutConfig): string | undefined {
    const c = cfg || getConfig();
    const map: Record<ProviderType, string> = {
        openrouter: c.secrets.openrouterApiUrl,
        openai: c.secrets.openaiApiUrl,
        anthropic: c.secrets.anthropicApiUrl,
        google: c.secrets.googleApiUrl,
        ollama: PROVIDER_URLS.ollama,
        'openai-compatible': c.secrets.openApiCompatibleApiUrl,
    };
    return map[provider] || PROVIDER_URLS[provider];
}

/**
 * Internal: resolve the provider URL from env for the default provider
 * (used during config loading before the config is fully built).
 */
function resolveProviderUrl(provider: ProviderType): string | undefined {
    const envUrlMap: Record<string, string> = {
        openrouter: 'OPENROUTER_API_URL',
        openai: 'OPENAI_API_URL',
        anthropic: 'ANTHROPIC_API_URL',
        google: 'GOOGLE_API_URL',
        'openai-compatible': 'OPEN_API_COMPATIBLE_API_URL',
    };
    const envKey = envUrlMap[provider];
    return envKey ? env(envKey) : undefined;
}

// ── Builder helpers ────────────────────────────────────

function buildRouterConfig(file: any, globalProvider: ProviderType, _globalBaseURL: string): RouterConfig {
    const fileFast = file?.fast || {};
    const fileBalanced = file?.balanced || {};
    const filePowerful = file?.powerful || {};

    return {
        fast: {
            model: fileFast.model || DEFAULTS.router.fast.model,
            provider: resolveProvider(fileFast.provider || globalProvider),
            baseURL: fileFast.baseURL,
        },
        balanced: {
            model: fileBalanced.model || DEFAULTS.router.balanced.model,
            provider: resolveProvider(fileBalanced.provider || globalProvider),
            baseURL: fileBalanced.baseURL,
        },
        powerful: {
            model: filePowerful.model || DEFAULTS.router.powerful.model,
            provider: resolveProvider(filePowerful.provider || globalProvider),
            baseURL: filePowerful.baseURL,
        },
    };
}

function buildBudgetConfig(file: any): BudgetConfig {
    return {
        dailyUSD: file?.dailyUSD ?? DEFAULTS.budget.dailyUSD,
        monthlyUSD: file?.monthlyUSD ?? DEFAULTS.budget.monthlyUSD,
        warningPct: file?.warningPct ?? DEFAULTS.budget.warningPct,
    };
}

function buildAgentConfig(file: any): AgentSettings {
    return {
        maxIterations: file?.maxIterations ?? DEFAULTS.agent.maxIterations,
        autoRegisterTools: file?.autoRegisterTools ?? DEFAULTS.agent.autoRegisterTools,
        port: intEnv('AGENT_PORT') ?? file?.port ?? DEFAULTS.agent.port,
    };
}

// ── Utilities ──────────────────────────────────────────

function intEnv(key: string): number | undefined {
    const v = env(key);
    if (v === undefined) return undefined;
    const n = parseInt(v, 10);
    return isNaN(n) ? undefined : n;
}

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
