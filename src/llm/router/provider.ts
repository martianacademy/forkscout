/**
 * Provider factory — creates AI SDK LanguageModel instances from provider config.
 *
 * Multi-provider support:
 *   - openrouter / openai / ollama / openai-compatible → @ai-sdk/openai
 *   - anthropic → @ai-sdk/anthropic (native Anthropic API)
 *   - google → @ai-sdk/google (native Google Generative AI API)
 *
 * Also contains createRouterFromEnv() which builds a RouterConfig
 * from forkscout.config.json + environment secrets.
 *
 * @module llm/router/provider
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { UsageTracker } from '../usage-tracker';
import { loadConfig, getConfig, resolveApiKeyForProvider, resolveApiUrlForProvider, type ProviderType } from '../../config';
import type { ModelTier, ModelTierConfig, ModelPricing, RouterConfig } from './types';
import { KNOWN_PRICES } from './types';

// ── Base URLs ──────────────────────────────────────────

/** Default base URLs for each provider type */
const PROVIDER_BASE_URLS: Record<ProviderType, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    openai: 'https://api.openai.com/v1',
    github: 'https://models.inference.ai.azure.com',
    ollama: 'http://localhost:11434/v1',
    anthropic: '',  // Anthropic SDK handles its own URL
    google: '',     // Google SDK handles its own URL
    'openai-compatible': '',
};

// ── Model creation ─────────────────────────────────────

/**
 * Create a LanguageModel from any supported provider.
 *
 * - openrouter / openai / ollama / openai-compatible → @ai-sdk/openai (OpenAI-compatible)
 * - anthropic → @ai-sdk/anthropic (native Anthropic API)
 * - google → @ai-sdk/google (native Google Generative AI API)
 */
export function createProviderModel(
    provider: ProviderType,
    modelId: string,
    apiKey: string,
    baseURL?: string,
): LanguageModel {
    switch (provider) {
        case 'anthropic': {
            const p = createAnthropic({
                apiKey,
                ...(baseURL ? { baseURL } : {}),
            });
            return p(modelId);
        }

        case 'google': {
            const p = createGoogleGenerativeAI({
                apiKey,
                ...(baseURL ? { baseURL } : {}),
            });
            return p(modelId);
        }

        case 'openrouter':
        case 'openai':
        case 'github':
        case 'ollama':
        case 'openai-compatible':
        default: {
            const resolvedURL = baseURL || PROVIDER_BASE_URLS[provider] || PROVIDER_BASE_URLS.openrouter;
            const p = createOpenAI({
                baseURL: resolvedURL,
                apiKey,
                // OpenRouter requires these headers for app identification
                ...(provider === 'openrouter' ? {
                    headers: {
                        'HTTP-Referer': getConfig().agent.appUrl,
                        'X-Title': getConfig().agent.appName,
                    },
                } : {}),
            });
            return p.chat(modelId);
        }
    }
}

// ── Router factory ─────────────────────────────────────

/** Build RouterConfig from forkscout.config.json + .env secrets */
export function createRouterFromEnv(): RouterConfig {
    const cfg = loadConfig();

    const globalProvider = cfg.provider;
    const globalBaseURL = cfg.baseURL;

    function getPricing(model: string): ModelPricing {
        return KNOWN_PRICES[model] || { inputPer1M: 1.0, outputPer1M: 3.0 };
    }

    function buildTierConfig(tier: 'fast' | 'balanced' | 'powerful'): ModelTierConfig {
        const tierCfg = cfg.router[tier];
        const tierProvider = tierCfg.provider || globalProvider;

        const tierApiKey = resolveApiKeyForProvider(tierProvider, cfg);
        const tierBaseURL = tierCfg.baseURL
            || resolveApiUrlForProvider(tierProvider, cfg)
            || (tierProvider === globalProvider ? globalBaseURL : undefined);

        return {
            modelId: tierCfg.model,
            pricing: getPricing(tierCfg.model),
            provider: tierProvider,
            apiKey: tierApiKey,
            baseURL: tierBaseURL,
        };
    }

    const config: RouterConfig = {
        provider: globalProvider,
        apiKey: resolveApiKeyForProvider(globalProvider, cfg),
        baseURL: globalBaseURL,
        tiers: {
            fast: buildTierConfig('fast'),
            balanced: buildTierConfig('balanced'),
            powerful: buildTierConfig('powerful'),
        },
        usage: UsageTracker.create(),
    };

    for (const t of ['fast', 'balanced', 'powerful'] as ModelTier[]) {
        const tc = config.tiers[t];
        console.log(`[Router]: ${t} → ${tc.modelId} via ${tc.provider}${tc.baseURL ? ` (${tc.baseURL})` : ''}`);
    }

    return config;
}

/** Look up pricing for any model ID */
export function getModelPricing(modelId: string): ModelPricing | undefined {
    return KNOWN_PRICES[modelId];
}
