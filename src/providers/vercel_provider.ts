// src/providers/vercel_provider.ts — Vercel AI Gateway: unified billing + observability across providers.
// Vercel AI Gateway provider using the official @ai-sdk/vercel package.
// Routes requests through Vercel's AI Gateway with unified billing + observability.
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/vercel

import { createVercel } from "@ai-sdk/vercel";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

/**
 * Creates a Vercel AI Gateway provider instance.
 *
 * @param apiKey - Optional API key. Falls back to VERCEL_API_KEY env var.
 */
export function createVercelProvider(apiKey?: string): OpenAICompatibleProvider {
    const provider = createVercel({
        apiKey: apiKey ?? process.env.VERCEL_API_KEY ?? "",
    });

    return {
        name: "vercel",
        chat(modelId: string): LanguageModel {
            return provider(modelId) as LanguageModel;
        },
    };
}
