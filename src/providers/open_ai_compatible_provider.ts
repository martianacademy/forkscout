// src/providers/open_ai_compatible_provider.ts — Factory for any OpenAI-compatible HTTP endpoint.
// Factory for any OpenAI-compatible HTTP endpoint (OpenRouter, Groq, Together, etc.)
//
// IMPORTANT: AI SDK v6 defaults to the Responses API for openai(modelId).
// For third-party compatible endpoints (OpenRouter, Groq, etc.) that only support
// Chat Completions, always use provider.chat(modelId) — not provider(modelId).
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/openai

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export interface OpenAICompatibleProviderOptions {
    /** Provider name — used as the model provider property. Defaults to 'openai'. */
    name: string;
    /** Base URL prefix for API calls, e.g. "https://openrouter.ai/api/v1" */
    baseURL: string;
    /** API key sent via the Authorization header */
    apiKey: string;
    /** Optional extra headers sent with every request */
    headers?: Record<string, string>;
    /** Optional custom fetch implementation (e.g. for response transformation) */
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface OpenAICompatibleProvider {
    name: string;
    /**
     * Returns a LanguageModel using the Chat Completions API.
     * Use this for any provider that does NOT support the OpenAI Responses API.
     */
    chat(modelId: string): LanguageModel;
}

/**
 * Creates a provider for any OpenAI-compatible endpoint.
 *
 * Uses createOpenAI from @ai-sdk/openai with a custom baseURL.
 * Always calls .chat() to force Chat Completions — required for providers
 * that don't implement the Responses API (OpenRouter, Groq, Together, etc.).
 */
export function createOpenAICompatibleProvider(
    options: OpenAICompatibleProviderOptions
): OpenAICompatibleProvider {
    const provider = createOpenAI({
        baseURL: options.baseURL,
        apiKey: options.apiKey,
        headers: options.headers,
        name: options.name,
        ...(options.fetch ? { fetch: options.fetch as typeof globalThis.fetch } : {}),
    });

    return {
        name: options.name,
        chat(modelId: string): LanguageModel {
            // .chat() explicitly selects the Chat Completions API.
            // This is required for OpenAI-compatible providers that don't
            // support the Responses API (which is the v6 default).
            return provider.chat(modelId) as LanguageModel;
        },
    };
}
