/**
 * Multi-Model Router — intelligent model selection based on task complexity.
 *
 * Three tiers:
 *   - FAST    → cheap, quick responses (summaries, classification, entity extraction)
 *   - BALANCED → everyday conversation, tool use, general tasks
 *   - POWERFUL → complex reasoning, coding, multi-step analysis
 *
 * The router:
 *   1. Selects the model tier based on the caller's declared purpose
 *   2. Consults the budget tracker — if over budget, downgrades the tier
 *   3. Falls back gracefully: powerful→balanced→fast→refuse
 *
 * Multi-provider support — each tier can use a different AI SDK provider:
 *   - openrouter / openai / ollama / openai-compatible → @ai-sdk/openai
 *   - anthropic → @ai-sdk/anthropic (direct Anthropic API)
 *   - google → @ai-sdk/google (direct Google Generative AI API)
 *
 * Configuration via env vars:
 *   MODEL_FAST            — model ID, e.g. "gemini-2.0-flash" or "google/gemini-2.0-flash-001"
 *   MODEL_BALANCED        — model ID, e.g. "grok-4.1-fast" or "x-ai/grok-4.1-fast"
 *   MODEL_POWERFUL        — model ID, e.g. "claude-sonnet-4" or "anthropic/claude-sonnet-4"
 *   MODEL_PROVIDER        — global provider for all tiers (default: LLM_PROVIDER or 'openrouter')
 *
 *   Per-tier provider override (optional):
 *   MODEL_FAST_PROVIDER   — e.g. "google"  (uses @ai-sdk/google directly)
 *   MODEL_FAST_API_KEY    — API key for this tier's provider
 *   MODEL_FAST_BASE_URL   — base URL override for this tier
 *   (same pattern for MODEL_BALANCED_* and MODEL_POWERFUL_*)
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { BudgetTracker } from './budget';
import { loadConfig, resolveApiKeyForProvider, type ProviderType } from '../config';

// ── Types ──────────────────────────────────────────────

/** Purpose declares what the LLM call is for — the router maps this to a tier */
export type ModelPurpose =
    | 'chat'              // Normal conversation → balanced
    | 'tool-use'          // Tool calling loops → balanced
    | 'summarize'         // Background summarization → fast
    | 'extract'           // Entity/classification extraction → fast
    | 'classify'          // Quick classification (urgency, intent) → fast
    | 'reason'            // Complex reasoning → powerful
    | 'code'              // Code generation/review → powerful
    | 'plan';             // Multi-step planning → powerful

export type ModelTier = 'fast' | 'balanced' | 'powerful';

/** How purpose maps to tier */
const PURPOSE_TO_TIER: Record<ModelPurpose, ModelTier> = {
    chat: 'balanced',
    'tool-use': 'balanced',
    summarize: 'fast',
    extract: 'fast',
    classify: 'fast',
    reason: 'powerful',
    code: 'powerful',
    plan: 'powerful',
};

/** Per-model pricing in USD per 1M tokens (input, output) */
export interface ModelPricing {
    inputPer1M: number;
    outputPer1M: number;
}

/**
 * Known model prices (USD per 1M tokens).
 * Source: OpenRouter pricing page, approximate as of early 2026.
 * Override with MODEL_<TIER>_INPUT_PRICE / MODEL_<TIER>_OUTPUT_PRICE env vars.
 */
const KNOWN_PRICES: Record<string, ModelPricing> = {
    // Ultra cheap / free
    'google/gemini-2.0-flash-001': { inputPer1M: 0.10, outputPer1M: 0.40 },
    'google/gemini-2.0-flash-lite-001': { inputPer1M: 0.0, outputPer1M: 0.0 },
    'google/gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.60 },
    'meta-llama/llama-3.3-70b-instruct': { inputPer1M: 0.13, outputPer1M: 0.26 },
    'deepseek/deepseek-chat-v3-0324': { inputPer1M: 0.20, outputPer1M: 0.90 },
    'qwen/qwen3-235b-a22b': { inputPer1M: 0.20, outputPer1M: 1.20 },
    'qwen/qwen-2.5-72b-instruct': { inputPer1M: 0.18, outputPer1M: 0.46 },

    // Mid-tier
    'x-ai/grok-4.1-fast': { inputPer1M: 3.0, outputPer1M: 12.0 },
    'openai/gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
    'openai/gpt-4.1-nano': { inputPer1M: 0.10, outputPer1M: 0.40 },
    'anthropic/claude-sonnet-4': { inputPer1M: 3.0, outputPer1M: 15.0 },
    'anthropic/claude-3.5-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },

    // Expensive / powerful
    'anthropic/claude-opus-4': { inputPer1M: 15.0, outputPer1M: 75.0 },
    'openai/gpt-4.1': { inputPer1M: 2.0, outputPer1M: 8.0 },
    'openai/o3': { inputPer1M: 10.0, outputPer1M: 40.0 },
    'openai/o4-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },
    'x-ai/grok-4': { inputPer1M: 6.0, outputPer1M: 18.0 },
    'google/gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.0 },
    'deepseek/deepseek-r1': { inputPer1M: 0.55, outputPer1M: 2.19 },
};

export interface ModelTierConfig {
    modelId: string;
    pricing: ModelPricing;
    /** Provider for this specific tier (overrides global) */
    provider: ProviderType;
    /** API key for this tier's provider (overrides global) */
    apiKey: string;
    /** Base URL for this tier's provider (overrides global) */
    baseURL?: string;
}

export interface RouterConfig {
    /** Default provider for tiers that don't specify their own */
    provider: ProviderType;
    /** Default API key */
    apiKey: string;
    /** Default base URL */
    baseURL: string;
    /** Model for each tier — each tier can have its own provider */
    tiers: Record<ModelTier, ModelTierConfig>;
    /** Budget tracker instance */
    budget: BudgetTracker;
}

// ── Router ─────────────────────────────────────────────

export class ModelRouter {
    private config: RouterConfig;
    private budget: BudgetTracker;

    constructor(config: RouterConfig) {
        this.config = config;
        this.budget = config.budget;
    }

    /** Get the model for a given purpose, respecting budget constraints */
    getModel(purpose: ModelPurpose = 'chat'): { model: LanguageModel; tier: ModelTier; modelId: string } {
        let tier = PURPOSE_TO_TIER[purpose] || 'balanced';

        // Budget gate — downgrade if budget is tight
        tier = this.budget.adjustTier(tier);

        const tierConfig = this.config.tiers[tier];
        const model = this.createModel(tierConfig);

        return { model, tier, modelId: tierConfig.modelId };
    }

    /** Get model for a specific tier directly */
    getModelByTier(tier: ModelTier): { model: LanguageModel; tier: ModelTier; modelId: string } {
        const adjusted = this.budget.adjustTier(tier);
        const tierConfig = this.config.tiers[adjusted];
        return { model: this.createModel(tierConfig), tier: adjusted, modelId: tierConfig.modelId };
    }

    /** Get pricing for a model ID */
    getPricing(modelId: string): ModelPricing {
        return KNOWN_PRICES[modelId] || this.findTierPricing(modelId) || { inputPer1M: 1.0, outputPer1M: 3.0 };
    }

    /** Get the pricing for a tier */
    getTierPricing(tier: ModelTier): ModelPricing {
        return this.config.tiers[tier].pricing;
    }

    /** Get the budget tracker */
    getBudget(): BudgetTracker {
        return this.budget;
    }

    /** Get the current config (for status endpoint) */
    getStatus(): {
        tiers: Record<ModelTier, { modelId: string; provider: string; inputPricePer1M: number; outputPricePer1M: number }>;
        budget: ReturnType<BudgetTracker['getStatus']>;
    } {
        const tiers: any = {};
        for (const t of ['fast', 'balanced', 'powerful'] as ModelTier[]) {
            const tc = this.config.tiers[t];
            tiers[t] = {
                modelId: tc.modelId,
                provider: tc.provider,
                inputPricePer1M: tc.pricing.inputPer1M,
                outputPricePer1M: tc.pricing.outputPer1M,
            };
        }
        return { tiers, budget: this.budget.getStatus() };
    }

    /** Override a tier's model at runtime (keeps the tier's existing provider) */
    setTierModel(tier: ModelTier, modelId: string): void {
        const pricing = KNOWN_PRICES[modelId] || { inputPer1M: 1.0, outputPer1M: 3.0 };
        const existing = this.config.tiers[tier];
        this.config.tiers[tier] = { ...existing, modelId, pricing };
        console.log(`[Router]: ${tier} tier → ${modelId} [${existing.provider}] ($${pricing.inputPer1M}/$${pricing.outputPer1M} per 1M tokens)`);
    }

    /** Record usage after an LLM call completes */
    recordUsage(tier: ModelTier, inputTokens: number, outputTokens: number): void {
        const pricing = this.config.tiers[tier].pricing;
        const cost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
        this.budget.recordSpend(cost, this.config.tiers[tier].modelId, inputTokens, outputTokens);
    }

    private createModel(tierConfig: ModelTierConfig): LanguageModel {
        return createProviderModel(tierConfig.provider, tierConfig.modelId, tierConfig.apiKey, tierConfig.baseURL);
    }

    private findTierPricing(modelId: string): ModelPricing | undefined {
        for (const tier of ['fast', 'balanced', 'powerful'] as ModelTier[]) {
            if (this.config.tiers[tier].modelId === modelId) {
                return this.config.tiers[tier].pricing;
            }
        }
        return undefined;
    }
}

// ── Provider Factory ──────────────────────────────────────

/** Default base URLs for each provider type */
const PROVIDER_BASE_URLS: Record<ProviderType, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    openai: 'https://api.openai.com/v1',
    ollama: 'http://localhost:11434/v1',
    anthropic: '',  // Anthropic SDK handles its own URL
    google: '',     // Google SDK handles its own URL
    'openai-compatible': '',
};

/**
 * Create a LanguageModel from any supported provider.
 *
 * - openrouter / openai / ollama / openai-compatible → @ai-sdk/openai (OpenAI-compatible)
 * - anthropic → @ai-sdk/anthropic (native Anthropic API)
 * - google → @ai-sdk/google (native Google Generative AI API)
 */
function createProviderModel(
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
        case 'ollama':
        case 'openai-compatible':
        default: {
            const resolvedURL = baseURL || PROVIDER_BASE_URLS[provider] || PROVIDER_BASE_URLS.openrouter;
            const p = createOpenAI({
                baseURL: resolvedURL,
                apiKey,
            });
            return p.chat(modelId);
        }
    }
}

// ── Factory ────────────────────────────────────────────

/** Build RouterConfig from forkscout.config.json + .env secrets */
export function createRouterFromEnv(): RouterConfig {
    const cfg = loadConfig();

    const globalProvider = cfg.provider;
    const globalBaseURL = cfg.baseURL;

    function getPricing(model: string, tier: string): ModelPricing {
        // Allow env var override for custom pricing
        const inputEnv = process.env[`MODEL_${tier.toUpperCase()}_INPUT_PRICE`];
        const outputEnv = process.env[`MODEL_${tier.toUpperCase()}_OUTPUT_PRICE`];
        if (inputEnv && outputEnv) {
            return { inputPer1M: parseFloat(inputEnv), outputPer1M: parseFloat(outputEnv) };
        }
        return KNOWN_PRICES[model] || { inputPer1M: 1.0, outputPer1M: 3.0 };
    }

    /** Build tier config from the unified config */
    function buildTierConfig(tier: 'fast' | 'balanced' | 'powerful'): ModelTierConfig {
        const tierCfg = cfg.router[tier];
        const tierProvider = tierCfg.provider || globalProvider;
        const tierUpper = tier.toUpperCase();

        // Per-tier API key: explicit env override → auto-resolve from provider
        const tierApiKey = process.env[`MODEL_${tierUpper}_API_KEY`]
            || resolveApiKeyForProvider(tierProvider, cfg);
        const tierBaseURL = tierCfg.baseURL
            || (tierProvider === globalProvider ? globalBaseURL : undefined);

        return {
            modelId: tierCfg.model,
            pricing: getPricing(tierCfg.model, tier),
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
        budget: BudgetTracker.fromConfig(cfg.budget),
    };

    // Log provider info for each tier
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
