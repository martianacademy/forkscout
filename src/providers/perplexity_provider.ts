// src/providers/perplexity_provider.ts — Perplexity provider: models with built-in web search grounding.
// Perplexity provider — OpenAI-compatible endpoint, no dedicated SDK needed.
// Perplexity models have built-in web search grounding.
// Docs: https://docs.perplexity.ai/api-reference/chat-completions

import {
    createOpenAICompatibleProvider,
    type OpenAICompatibleProvider,
} from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates a Perplexity provider instance.
 *
 * @param apiKey - Optional API key. Falls back to PERPLEXITY_API_KEY env var.
 */
export function createPerplexityProvider(apiKey?: string): OpenAICompatibleProvider {
    return createOpenAICompatibleProvider({
        name: "perplexity",
        baseURL: "https://api.perplexity.ai",
        apiKey: apiKey ?? process.env.PERPLEXITY_API_KEY ?? "",
    });
}
