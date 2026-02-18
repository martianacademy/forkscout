/**
 * Config loader — reads forkscout.config.json + .env secrets.
 *
 * Singleton pattern: loads once and caches. Call `loadConfig(true)` to force reload.
 *
 * Resolution order:
 *   1. forkscout.config.json (committed, version-controlled)
 *   2. .env secrets (gitignored, runtime only)
 *   3. Environment variable overrides (backward compat)
 *   4. Built-in defaults
 *
 * @module config/loader
 */

import { readFileSync } from 'fs';
import type { ProviderType, ForkscoutConfig } from './types';
import { DEFAULTS, PROVIDER_URLS } from './types';
import {
    buildRouterConfig, buildBudgetConfig, buildAgentConfig,
    resolveProvider, resolveProviderUrl, env, findConfigFile,
} from './builders';

// ── Singleton ──────────────────────────────────────────

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
        env('DEFAULT_PROVIDER') || fileConfig.provider || DEFAULTS.provider,
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

/** Get the cached config (loads on first call if not yet loaded). */
export function getConfig(): ForkscoutConfig {
    if (!_config) return loadConfig();
    return _config;
}

// ── Provider API key/URL resolution ────────────────────

/**
 * Resolve the API key for a given provider type.
 * Priority: provider-specific env var → LLM_API_KEY → empty string.
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
 * Priority: provider-specific env URL → PROVIDER_URLS default.
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
