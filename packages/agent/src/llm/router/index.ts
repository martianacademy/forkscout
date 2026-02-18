/**
 * Multi-model router barrel — re-exports router class, factory, types, and pricing.
 *
 * @module llm/router
 */

export { ModelRouter } from './router';
export { createRouterFromEnv, getModelPricing, createProviderModel } from './provider';
export type {
    ModelPurpose,
    ModelTier,
    ModelPricing,
    ModelTierConfig,
    RouterConfig,
} from './types';
export { KNOWN_PRICES, PURPOSE_TO_TIER } from './types';
