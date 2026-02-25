// src/providers/deepseek_provider.ts
// DeepSeek provider using the official @ai-sdk/deepseek package.
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/deepseek

import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates a DeepSeek provider instance.
 *
 * @param apiKey - Optional API key. Falls back to DEEPSEEK_API_KEY env var.
 */
export function createDeepSeekProvider(apiKey?: string): OpenAICompatibleProvider {
    const provider = createDeepSeek({
        apiKey: apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
    });

    return {
        name: "deepseek",
        chat(modelId: string): LanguageModel {
            return provider(modelId) as LanguageModel;
        },
    };
}
