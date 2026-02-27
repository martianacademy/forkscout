// src/providers/xai_provider.ts — xAI (Grok) provider via @ai-sdk/xai.
// xAI (Grok) provider using the official @ai-sdk/xai package.
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/xai

import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates an xAI (Grok) provider instance.
 *
 * @param apiKey - Optional API key. Falls back to XAI_API_KEY env var.
 */
export function createXaiProvider(apiKey?: string): OpenAICompatibleProvider {
    const provider = createXai({
        apiKey: apiKey ?? process.env.XAI_API_KEY ?? "",
    });

    return {
        name: "xai",
        chat(modelId: string): LanguageModel {
            return provider(modelId) as LanguageModel;
        },
    };
}
