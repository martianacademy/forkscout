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
// OpenRouter returns model reasoning in a non-standard `message.reasoning` /
// `delta.reasoning` field that the AI SDK silently discards. We use a custom
// fetch wrapper (makeReasoningFetch) to inject reasoning into message.content
// as <think>...</think> tags so extractReasoningMiddleware can lift them out.
//
// Docs: https://openrouter.ai/docs
//       https://ai-sdk.dev/providers/ai-sdk-providers/openai

import {
    createOpenAICompatibleProvider,
    type OpenAICompatibleProvider,
} from "@/providers/open_ai_compatible_provider.ts";
import { makeReasoningFetch } from "@/providers/reasoning-fetch-transform.ts";
import { getConfig } from "@/config.ts";

/**
 * Creates an OpenRouter provider instance.
 *
 * @param apiKey - Optional API key. Falls back to OPENROUTER_API_KEY env var.
 */
export function createOpenRouterProvider(
    apiKey?: string
): OpenAICompatibleProvider {
    const { agent, llm } = getConfig();
    const reasoningTag = llm.reasoningTag?.trim();
    return createOpenAICompatibleProvider({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
        headers: {
            "HTTP-Referer": agent.github,
            "X-Title": agent.name,
        },
        // Intercept raw HTTP responses to move delta.reasoning / message.reasoning
        // into delta.content / message.content as <think>...</think> tags.
        // Only applied when reasoningTag is configured.
        ...(reasoningTag ? { fetch: makeReasoningFetch(reasoningTag) } : {}),
    });
}
