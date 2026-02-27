// src/providers/index.ts — Provider registry: getProvider(), getModel(), getModelForRole().
// Registry of known providers + getModel() + getModelForRole() helpers.
// To add a new provider: add a key to `registry` below.
//
// Model string format: "<provider>/<model-id>"
// Example: "openrouter/minimax/minimax-m2.5"

import type { LanguageModel } from "ai";
import type { LLMConfig } from "@/config.ts";
import {
    createOpenAICompatibleProvider,
    type OpenAICompatibleProvider,
} from "@/providers/open_ai_compatible_provider.ts";
import { createOpenRouterProvider } from "@/providers/openrouter_provider.ts";
import { createAnthropicProvider } from "@/providers/anthropic_provider.ts";
import { createGoogleProvider } from "@/providers/google_provider.ts";
import { createXaiProvider } from "@/providers/xai_provider.ts";
import { createVercelProvider } from "@/providers/vercel_provider.ts";
import { createReplicateProvider } from "@/providers/replicate_provider.ts";
import { createHuggingFaceProvider } from "@/providers/huggingface_provider.ts";
import { createDeepSeekProvider } from "@/providers/deepseek_provider.ts";
import { createPerplexityProvider } from "@/providers/perplexity_provider.ts";

// ── Provider registry ────────────────────────────────────────────────────────
// Each key is the prefix used in the model string (before the first "/").
// Providers are lazily resolved so env vars are read at call time.

const registry: Record<string, () => OpenAICompatibleProvider> = {
    openrouter: () => createOpenRouterProvider(),
    anthropic: () => createAnthropicProvider(),
    google: () => createGoogleProvider(),
    xai: () => createXaiProvider(),
    vercel: () => createVercelProvider(),
    replicate: () => createReplicateProvider(),
    huggingface: () => createHuggingFaceProvider(),
    deepseek: () => createDeepSeekProvider(),
    perplexity: () => createPerplexityProvider(),
    // Add more providers below, e.g.:
    // groq: () => createOpenAICompatibleProvider({ name: "groq", baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY ?? "" }),
    // together: () => createOpenAICompatibleProvider({ name: "together", baseURL: "https://api.together.xyz/v1", apiKey: process.env.TOGETHER_API_KEY ?? "" }),
};

// Cache instantiated providers
const _cache: Record<string, OpenAICompatibleProvider> = {};

export function getProvider(prefix: string): OpenAICompatibleProvider {
    if (!_cache[prefix]) {
        const factory = registry[prefix];
        if (!factory) {
            throw new Error(
                `Unknown provider "${prefix}" — known providers: ${Object.keys(registry).join(", ")}`
            );
        }
        _cache[prefix] = factory();
    }
    return _cache[prefix];
}

/**
 * Parses a model string and returns the LanguageModel.
 *
 * Format: "<provider>/<model-id>"
 * Example: "openrouter/minimax/minimax-m2.5"
 *          └─ provider: "openrouter", modelId: "minimax/minimax-m2.5"
 */
export function getModel(modelString: string): LanguageModel {
    const slashIndex = modelString.indexOf("/");
    if (slashIndex === -1) {
        throw new Error(
            `Invalid model string "${modelString}" — expected format: "<provider>/<model-id>"`
        );
    }

    const prefix = modelString.slice(0, slashIndex);
    const modelId = modelString.slice(slashIndex + 1);

    return getProvider(prefix).chat(modelId);
}

export type { OpenAICompatibleProvider };
export { createOpenAICompatibleProvider };

// ── Role-based model selection ────────────────────────────────────────────────

/**
 * Named purpose/role for model selection.
 * Each role maps to an optional field in ModelTiers.
 * If the role field is empty or undefined, a sensible tier is used as fallback.
 */
export type ModelRole = keyof import("@/config.ts").ModelTiers;

/** Fallback tier when a role's model string is absent or empty. */
const ROLE_FALLBACK: Partial<Record<ModelRole, ModelRole>> = {
    vision: "balanced",
    summarizer: "fast",
    browser: "balanced",
    transcriber: "fast",
    tts: "balanced",
};

/**
 * Return a LanguageModel for the given role using the active provider.
 *
 * Resolution order:
 * 1. `llm.providers[provider][role]` — if non-empty
 * 2. `llm.providers[provider][ROLE_FALLBACK[role]]` — if defined
 *
 * @throws if neither the role nor its fallback tier has a model configured
 */
export function getModelForRole(role: ModelRole, llmConfig: LLMConfig): LanguageModel {
    const { provider, providers } = llmConfig;
    const tiers = providers[provider];
    if (!tiers) {
        throw new Error(`Provider "${provider}" has no model tiers configured`);
    }

    const direct = tiers[role];
    if (direct) return getProvider(provider).chat(direct);

    const fallbackRole = ROLE_FALLBACK[role];
    const fallback = fallbackRole ? tiers[fallbackRole] : undefined;
    if (fallback) return getProvider(provider).chat(fallback);

    throw new Error(
        `No model configured for role "${role}" on provider "${provider}" and no fallback available`
    );
}