// src/providers/huggingface_provider.ts — HuggingFace Inference provider: thousands of open-source models.
// HuggingFace Inference provider using the official @ai-sdk/huggingface package.
// Access thousands of open-source models via HuggingFace's Inference API.
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/huggingface

import { createHuggingFace } from "@ai-sdk/huggingface";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates a HuggingFace Inference provider instance.
 *
 * @param apiKey - Optional API key. Falls back to HUGGINGFACE_API_KEY env var.
 */
export function createHuggingFaceProvider(apiKey?: string): OpenAICompatibleProvider {
    const provider = createHuggingFace({
        apiKey: apiKey ?? process.env.HUGGINGFACE_API_KEY ?? "",
    });

    return {
        name: "huggingface",
        chat(modelId: string): LanguageModel {
            return provider(modelId) as LanguageModel;
        },
    };
}
