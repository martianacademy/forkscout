/**
 * ModelRouter — selects the right model tier for each LLM call
 * and records token usage for analytics.
 *
 * @module llm/router/router
 */

import type { LanguageModel } from 'ai';
import type { UsageTracker } from '../usage-tracker';
import type {
    ModelPurpose, ModelTier, ModelPricing, RouterConfig, ModelTierConfig,
} from './types';
import { PURPOSE_TO_TIER, KNOWN_PRICES } from './types';
import { createProviderModel } from './provider';
import { createFallbackModel } from '../fallback-model';

export class ModelRouter {
    private config: RouterConfig;
    private usage: UsageTracker;

    constructor(config: RouterConfig) {
        this.config = config;
        this.usage = config.usage;
    }

    /** Get the model for a given purpose. */
    getModel(purpose: ModelPurpose = 'chat'): { model: LanguageModel; tier: ModelTier; modelId: string } {
        const tier = PURPOSE_TO_TIER[purpose] || 'balanced';
        const tierConfig = this.config.tiers[tier];
        const model = this.createModel(tierConfig);
        return { model, tier, modelId: tierConfig.modelId };
    }

    /** Get model for a specific tier directly. */
    getModelByTier(tier: ModelTier): { model: LanguageModel; tier: ModelTier; modelId: string } {
        const tierConfig = this.config.tiers[tier];
        return { model: this.createModel(tierConfig), tier, modelId: tierConfig.modelId };
    }

    /** Get pricing for a model ID. */
    getPricing(modelId: string): ModelPricing {
        return KNOWN_PRICES[modelId] || this.findTierPricing(modelId) || { inputPer1M: 1.0, outputPer1M: 3.0 };
    }

    /** Get the pricing for a tier. */
    getTierPricing(tier: ModelTier): ModelPricing {
        return this.config.tiers[tier].pricing;
    }

    /** Get the usage tracker (analytics). */
    getUsage(): UsageTracker {
        return this.usage;
    }

    /** Get the current config (for status endpoint). */
    getStatus(): {
        tiers: Record<ModelTier, { modelId: string; provider: string; inputPricePer1M: number; outputPricePer1M: number }>;
        usage: ReturnType<UsageTracker['getStatus']>;
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
        return { tiers, usage: this.usage.getStatus() };
    }

    /** Override a tier's model at runtime (keeps the tier's existing provider). */
    setTierModel(tier: ModelTier, modelId: string): void {
        const pricing = KNOWN_PRICES[modelId] || { inputPer1M: 1.0, outputPer1M: 3.0 };
        const existing = this.config.tiers[tier];
        this.config.tiers[tier] = { ...existing, modelId, pricing };
        console.log(`[Router]: ${tier} tier → ${modelId} [${existing.provider}] ($${pricing.inputPer1M}/$${pricing.outputPer1M} per 1M tokens)`);
    }

    /**
     * Hot-reload: swap the router's config in-place.
     * Preserves the existing UsageTracker state (spending history).
     */
    reloadConfig(newConfig: RouterConfig): void {
        // Preserve existing usage state — don't reset spending counters
        this.config = { ...newConfig, usage: this.usage };
        for (const t of ['fast', 'balanced', 'powerful'] as ModelTier[]) {
            const tc = this.config.tiers[t];
            console.log(`[Router↻]: ${t} → ${tc.modelId} via ${tc.provider}`);
        }
    }

    /** Record usage after an LLM call completes (analytics only). */
    recordUsage(tier: ModelTier, inputTokens: number, outputTokens: number): void {
        const pricing = this.config.tiers[tier].pricing;
        const cost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
        this.usage.recordSpend(cost, this.config.tiers[tier].modelId, inputTokens, outputTokens);
    }

    private createModel(tierConfig: ModelTierConfig): LanguageModel {
        const model = createProviderModel(tierConfig.provider, tierConfig.modelId, tierConfig.apiKey, tierConfig.baseURL);
        return createFallbackModel(model);
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
