// src/providers/replicate_provider.ts
// Replicate provider using the official @ai-sdk/replicate package.
// Run open-source models (Llama, Mistral, etc.) on Replicate's infrastructure.
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/replicate

import { createReplicate } from "@ai-sdk/replicate";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates a Replicate provider instance.
 *
 * @param apiKey - Optional API key. Falls back to REPLICATE_API_TOKEN env var.
 */
export function createReplicateProvider(apiKey?: string): OpenAICompatibleProvider {
    const provider = createReplicate({
        apiToken: apiKey ?? process.env.REPLICATE_API_TOKEN ?? "",
    });

    return {
        name: "replicate",
        chat(modelId: string): LanguageModel {
            // Replicate uses .languageModel() instead of being directly callable
            return provider.languageModel(modelId) as LanguageModel;
        },
    };
}
