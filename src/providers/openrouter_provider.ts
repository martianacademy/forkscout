// src/providers/openrouter_provider.ts
// OpenRouter provider — wraps createOpenAICompatibleProvider with OpenRouter-specific config.
//
// OpenRouter is an OpenAI-compatible proxy that only supports Chat Completions,
// NOT the OpenAI Responses API. The base factory handles this by always using .chat().
//
// Required headers per OpenRouter docs:
//   HTTP-Referer — identifies your app to OpenRouter
//   X-Title      — display name shown in OpenRouter dashboard
//
// Docs: https://openrouter.ai/docs
//       https://ai-sdk.dev/providers/ai-sdk-providers/openai

import {
    createOpenAICompatibleProvider,
    type OpenAICompatibleProvider,
} from "@/providers/open_ai_compatible_provider.ts";
import { getConfig } from "@/config.ts";

/**
 * Creates an OpenRouter provider instance.
 *
 * @param apiKey - Optional API key. Falls back to OPENROUTER_API_KEY env var.
 */
export function createOpenRouterProvider(
    apiKey?: string
): OpenAICompatibleProvider {
    const { agent } = getConfig();
    return createOpenAICompatibleProvider({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
        headers: {
            "HTTP-Referer": agent.github,
            "X-Title": agent.name,
        },
    });
}
