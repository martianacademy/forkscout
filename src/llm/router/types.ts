/**
 * Router types — model tiers, purposes, pricing, and configuration.
 *
 * @module llm/router/types
 */

import type { UsageTracker } from '../usage-tracker';
import type { ProviderType } from '../../config';

// ── Purpose & Tier ─────────────────────────────────────

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
export const PURPOSE_TO_TIER: Record<ModelPurpose, ModelTier> = {
    chat: 'balanced',
    'tool-use': 'balanced',
    summarize: 'fast',
    extract: 'fast',
    classify: 'fast',
    reason: 'powerful',
    code: 'powerful',
    plan: 'powerful',
};

// ── Pricing ────────────────────────────────────────────

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
export const KNOWN_PRICES: Record<string, ModelPricing> = {
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

// ── Tier & Router config ───────────────────────────────

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
    /** Usage analytics tracker */
    usage: UsageTracker;
}
