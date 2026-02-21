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

import { readFileSync, watch, type FSWatcher } from 'fs';
import type { ProviderType, ForkscoutConfig } from './types';
import { DEFAULTS, PROVIDER_URLS } from './types';
import {
    buildRouterConfig, buildAgentConfig,
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

    const { router, routerPresets } = buildRouterConfig(fileConfig.router, provider, baseURL);

    // Auto-resolve default model: explicit > env > balanced tier from router > fallback
    const model = env('DEFAULT_MODEL')
        || fileConfig.model
        || router.balanced.model
        || DEFAULTS.model;

    // Parse fallback providers — filter to valid ProviderType values
    const validProviders: Set<string> = new Set(['openrouter', 'openai', 'anthropic', 'google', 'github', 'ollama', 'openai-compatible']);
    const fallbackProviders: ProviderType[] = Array.isArray(fileConfig.fallbackProviders)
        ? (fileConfig.fallbackProviders as string[])
            .filter((p): p is ProviderType => validProviders.has(p) && p !== provider)
        : [];

    const config: ForkscoutConfig = {
        provider,
        model,
        baseURL,
        temperature: fileConfig.temperature ?? DEFAULTS.temperature,
        maxTokens: fileConfig.maxTokens ?? DEFAULTS.maxTokens,
        fallbackProviders,

        router,
        ...(routerPresets ? { routerPresets } : {}),
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
            githubApiKey: env('GITHUB_API_KEY') || '',
            githubApiUrl: env('GITHUB_API_URL') || PROVIDER_URLS.github,
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
        github: c.secrets.githubApiKey,
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
        github: c.secrets.githubApiUrl,
        ollama: PROVIDER_URLS.ollama,
        'openai-compatible': c.secrets.openApiCompatibleApiUrl,
    };
    return map[provider] || PROVIDER_URLS[provider];
}

// ── Hot-reload file watcher ────────────────────────────

let _watcher: FSWatcher | null = null;

/**
 * Watch forkscout.config.json for changes and call `onChange` with the fresh config.
 *
 * Uses a 500ms debounce to coalesce editor "save" events (some editors fire
 * multiple change events per save).  Only triggers when the config actually
 * parses successfully — malformed JSON is silently ignored so the agent
 * continues running with the previous config.
 *
 * Returns a cleanup function that stops the watcher.
 */
export function watchConfig(onChange: (cfg: ForkscoutConfig) => void): () => void {
    const configPath = findConfigFile();
    if (!configPath) {
        console.warn('[Config↻] No config file found — hot-reload disabled');
        return () => { };
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    _watcher = watch(configPath, (eventType) => {
        if (eventType !== 'change') return;

        // Debounce: coalesce rapid-fire events into a single reload
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            try {
                const fresh = loadConfig(true);
                console.log(`[Config↻] Reloaded — provider: ${fresh.provider}, model: ${fresh.model}`);
                onChange(fresh);
            } catch (e: any) {
                console.warn(`[Config↻] Reload failed (keeping previous config): ${e.message}`);
            }
        }, 500);
    });

    console.log(`[Config↻] Watching ${configPath} for changes`);
    return () => {
        if (_watcher) { _watcher.close(); _watcher = null; }
        if (debounceTimer) clearTimeout(debounceTimer);
    };
}
