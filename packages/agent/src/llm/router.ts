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
 * Configuration via env vars:
 *   MODEL_FAST       — e.g. "google/gemini-2.0-flash-001"
 *   MODEL_BALANCED   — e.g. "x-ai/grok-4.1-fast"  (defaults to LLM_MODEL)
 *   MODEL_POWERFUL   — e.g. "anthropic/claude-sonnet-4"   (defaults to LLM_MODEL)
 *   MODEL_PROVIDER   — provider for all tiers (defaults to LLM_PROVIDER)
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BudgetTracker } from './budget';

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
}

export interface RouterConfig {
    /** Provider for all models (default: from LLM_PROVIDER or 'openrouter') */
    provider: string;
    /** API key */
    apiKey: string;
    /** Base URL */
    baseURL: string;
    /** Model for each tier */
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
        const model = this.createModel(tierConfig.modelId);

        return { model, tier, modelId: tierConfig.modelId };
    }

    /** Get model for a specific tier directly */
    getModelByTier(tier: ModelTier): { model: LanguageModel; tier: ModelTier; modelId: string } {
        const adjusted = this.budget.adjustTier(tier);
        const tierConfig = this.config.tiers[adjusted];
        return { model: this.createModel(tierConfig.modelId), tier: adjusted, modelId: tierConfig.modelId };
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
        tiers: Record<ModelTier, { modelId: string; inputPricePer1M: number; outputPricePer1M: number }>;
        budget: ReturnType<BudgetTracker['getStatus']>;
    } {
        const tiers: any = {};
        for (const t of ['fast', 'balanced', 'powerful'] as ModelTier[]) {
            const tc = this.config.tiers[t];
            tiers[t] = { modelId: tc.modelId, inputPricePer1M: tc.pricing.inputPer1M, outputPricePer1M: tc.pricing.outputPer1M };
        }
        return { tiers, budget: this.budget.getStatus() };
    }

    /** Override a tier's model at runtime */
    setTierModel(tier: ModelTier, modelId: string): void {
        const pricing = KNOWN_PRICES[modelId] || { inputPer1M: 1.0, outputPer1M: 3.0 };
        this.config.tiers[tier] = { modelId, pricing };
        console.log(`[Router]: ${tier} tier → ${modelId} ($${pricing.inputPer1M}/$${pricing.outputPer1M} per 1M tokens)`);
    }

    /** Record usage after an LLM call completes */
    recordUsage(tier: ModelTier, inputTokens: number, outputTokens: number): void {
        const pricing = this.config.tiers[tier].pricing;
        const cost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
        this.budget.recordSpend(cost, this.config.tiers[tier].modelId, inputTokens, outputTokens);
    }

    private createModel(modelId: string): LanguageModel {
        const p = createOpenAI({
            baseURL: this.config.baseURL,
            apiKey: this.config.apiKey,
        });
        return p.chat(modelId);
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

// ── Factory ────────────────────────────────────────────

/** Build RouterConfig from environment variables */
export function createRouterFromEnv(): RouterConfig {
    const provider = process.env.MODEL_PROVIDER || process.env.LLM_PROVIDER || 'openrouter';

    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseURLMap: Record<string, string> = {
        openrouter: 'https://openrouter.ai/api/v1',
        openai: 'https://api.openai.com/v1',
        ollama: 'http://localhost:11434/v1',
    };
    const baseURL = process.env.LLM_BASE_URL || baseURLMap[provider] || 'https://openrouter.ai/api/v1';

    // Default model = whatever LLM_MODEL is (the "current" model)
    const defaultModel = process.env.LLM_MODEL || 'x-ai/grok-4.1-fast';

    // Tier models — each can be overridden individually
    const fastModel = process.env.MODEL_FAST || 'google/gemini-2.0-flash-001';
    const balancedModel = process.env.MODEL_BALANCED || defaultModel;
    const powerfulModel = process.env.MODEL_POWERFUL || defaultModel;

    function getPricing(model: string, tier: string): ModelPricing {
        // Allow env var override
        const inputEnv = process.env[`MODEL_${tier.toUpperCase()}_INPUT_PRICE`];
        const outputEnv = process.env[`MODEL_${tier.toUpperCase()}_OUTPUT_PRICE`];
        if (inputEnv && outputEnv) {
            return { inputPer1M: parseFloat(inputEnv), outputPer1M: parseFloat(outputEnv) };
        }
        return KNOWN_PRICES[model] || { inputPer1M: 1.0, outputPer1M: 3.0 };
    }

    return {
        provider,
        apiKey,
        baseURL,
        tiers: {
            fast: { modelId: fastModel, pricing: getPricing(fastModel, 'fast') },
            balanced: { modelId: balancedModel, pricing: getPricing(balancedModel, 'balanced') },
            powerful: { modelId: powerfulModel, pricing: getPricing(powerfulModel, 'powerful') },
        },
        budget: BudgetTracker.fromEnv(),
    };
}

/** Look up pricing for any model ID */
export function getModelPricing(modelId: string): ModelPricing | undefined {
    return KNOWN_PRICES[modelId];
}
