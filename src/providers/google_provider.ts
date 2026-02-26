// src/providers/google_provider.ts — Google Generative AI provider (Gemini) via @ai-sdk/google.
// Google Generative AI provider using the official @ai-sdk/google package.
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates a Google Generative AI provider instance.
 *
 * @param apiKey - Optional API key. Falls back to GOOGLE_GENERATIVE_AI_API_KEY env var.
 */
export function createGoogleProvider(apiKey?: string): OpenAICompatibleProvider {
    const provider = createGoogleGenerativeAI({
        apiKey: apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "",
    });

    return {
        name: "google",
        chat(modelId: string): LanguageModel {
            return provider(modelId) as LanguageModel;
        },
    };
}
