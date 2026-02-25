// src/providers/anthropic_provider.ts
// Anthropic provider using the official @ai-sdk/anthropic package.
//
// Unlike OpenAI-compatible providers, Anthropic has its own native SDK integration
// which handles authentication, content blocks, and tool use natively.
//
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/anthropic

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates an Anthropic provider instance.
 *
 * @param apiKey - Optional API key. Falls back to ANTHROPIC_API_KEY env var.
 */
export function createAnthropicProvider(
    apiKey?: string
): OpenAICompatibleProvider {
    const provider = createAnthropic({
        apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
    });

    return {
        name: "anthropic",
        chat(modelId: string): LanguageModel {
            // createAnthropic()(modelId) returns a LanguageModel directly
            return provider(modelId) as LanguageModel;
        },
    };
}
