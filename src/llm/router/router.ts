/**
 * ModelRouter — selects the right model tier for each LLM call,
 * respects budget constraints, and records token usage.
 *
 * @module llm/router/router
 */

import type { LanguageModel } from 'ai';
import type { BudgetTracker } from '../budget';
import type {
    ModelPurpose, ModelTier, ModelPricing, RouterConfig, ModelTierConfig,
} from './types';
import { PURPOSE_TO_TIER, KNOWN_PRICES } from './types';
import { createProviderModel } from './provider';
import { createFallbackModel } from '../fallback-model';

export class ModelRouter {
    private config: RouterConfig;
    private budget: BudgetTracker;

    constructor(config: RouterConfig) {
        this.config = config;
        this.budget = config.budget;
    }

    /** Get the model for a given purpose, respecting budget constraints. */
    getModel(purpose: ModelPurpose = 'chat'): { model: LanguageModel; tier: ModelTier; modelId: string } {
        let tier = PURPOSE_TO_TIER[purpose] || 'balanced';
        tier = this.budget.adjustTier(tier);

        const tierConfig = this.config.tiers[tier];
        const model = this.createModel(tierConfig);

        return { model, tier, modelId: tierConfig.modelId };
    }

    /** Get model for a specific tier directly. */
    getModelByTier(tier: ModelTier): { model: LanguageModel; tier: ModelTier; modelId: string } {
        const adjusted = this.budget.adjustTier(tier);
        const tierConfig = this.config.tiers[adjusted];
        return { model: this.createModel(tierConfig), tier: adjusted, modelId: tierConfig.modelId };
    }

    /** Get pricing for a model ID. */
    getPricing(modelId: string): ModelPricing {
        return KNOWN_PRICES[modelId] || this.findTierPricing(modelId) || { inputPer1M: 1.0, outputPer1M: 3.0 };
    }

    /** Get the pricing for a tier. */
    getTierPricing(tier: ModelTier): ModelPricing {
        return this.config.tiers[tier].pricing;
    }

    /** Get the budget tracker. */
    getBudget(): BudgetTracker {
        return this.budget;
    }

    /** Get the current config (for status endpoint). */
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

    /** Override a tier's model at runtime (keeps the tier's existing provider). */
    setTierModel(tier: ModelTier, modelId: string): void {
        const pricing = KNOWN_PRICES[modelId] || { inputPer1M: 1.0, outputPer1M: 3.0 };
        const existing = this.config.tiers[tier];
        this.config.tiers[tier] = { ...existing, modelId, pricing };
        console.log(`[Router]: ${tier} tier → ${modelId} [${existing.provider}] ($${pricing.inputPer1M}/$${pricing.outputPer1M} per 1M tokens)`);
    }

    /**
     * Hot-reload: swap the router's config in-place.
     * Preserves the existing BudgetTracker state (spending totals, limits).
     */
    reloadConfig(newConfig: RouterConfig): void {
        // Preserve existing budget state — don't reset spending counters
        this.config = { ...newConfig, budget: this.budget };
        for (const t of ['fast', 'balanced', 'powerful'] as ModelTier[]) {
            const tc = this.config.tiers[t];
            console.log(`[Router↻]: ${t} → ${tc.modelId} via ${tc.provider}`);
        }
    }

    /** Record usage after an LLM call completes. */
    recordUsage(tier: ModelTier, inputTokens: number, outputTokens: number): void {
        const pricing = this.config.tiers[tier].pricing;
        const cost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
        this.budget.recordSpend(cost, this.config.tiers[tier].modelId, inputTokens, outputTokens);
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
