/**
 * Fallback Model Wrapper — wraps a LanguageModel with automatic provider fallback.
 *
 * When the primary model fails with auth (401/403) or network errors,
 * automatically switches to the next configured fallback provider and
 * retries the same call. Transparent to all callers (ToolLoopAgent,
 * generateText, generateObject, streamText, etc.)
 *
 * Uses AI SDK's wrapLanguageModel + LanguageModelMiddleware for a clean,
 * type-safe implementation that works with any AI SDK consumer.
 *
 * @module llm/fallback-model
 */

import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import { getConfig } from '../config';
import { resolveApiKeyForProvider, resolveApiUrlForProvider } from '../config/loader';
import { createProviderModel } from './router/provider';
import type { ProviderType } from '../config';

// ── Error classification (lightweight copy for this module) ────

function isAuthOrNetworkError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const statusMatch = msg.match(/status[:\s]*(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 0;

    // Auth errors
    if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('authentication')) {
        return true;
    }

    // Network errors
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('fetch failed')) {
        return true;
    }

    // Server down
    if (status === 502 || status === 503) {
        return true;
    }

    return false;
}

/**
 * Resolve the first available fallback model from the configured providers.
 * Returns a raw LanguageModel from createProviderModel (which is always a V3 model object).
 */
function resolveFallbackModel(fallbackProviders: ProviderType[], currentModelId: string): LanguageModel | null {
    const cfg = getConfig();

    for (const fbProvider of fallbackProviders) {
        const apiKey = resolveApiKeyForProvider(fbProvider, cfg);
        if (!apiKey) {
            console.warn(`[Fallback]: Skipping ${fbProvider} — no API key configured`);
            continue;
        }

        const presets = cfg.routerPresets?.[fbProvider];
        const fallbackModelId = presets?.balanced?.model || currentModelId;
        const baseURL = resolveApiUrlForProvider(fbProvider, cfg);

        try {
            const model = createProviderModel(fbProvider, fallbackModelId, apiKey, baseURL);
            console.log(`[Fallback]: ✓ Switching to ${fbProvider} (${fallbackModelId})`);
            return model;
        } catch (e) {
            console.warn(`[Fallback]: Failed to create model for ${fbProvider}: ${e instanceof Error ? e.message : e}`);
        }
    }

    return null;
}

/**
 * Create a LanguageModel that automatically falls back to alternative
 * providers on auth or network failures.
 *
 * Usage:
 *   const model = createFallbackModel(primaryModel);
 *   // Use model everywhere — fallback is transparent
 */
export function createFallbackModel(primary: LanguageModel): LanguageModel {
    const cfg = getConfig();
    if (!cfg.fallbackProviders || cfg.fallbackProviders.length === 0) {
        // No fallbacks configured — return primary as-is (zero overhead)
        return primary;
    }

    // primary from createProviderModel is always a V3 model object (never a string)
    const fallbackProviders = cfg.fallbackProviders;
    const primaryModelId = typeof primary === 'string' ? primary : primary.modelId;

    const fallbackMiddleware: LanguageModelMiddleware = {
        specificationVersion: 'v3',

        wrapGenerate: async ({ doGenerate, params }) => {
            try {
                return await doGenerate();
            } catch (error) {
                if (!isAuthOrNetworkError(error)) throw error;

                const errMsg = error instanceof Error ? error.message : String(error);
                console.warn(`[Fallback]: Primary model failed: ${errMsg.slice(0, 150)}. Trying fallbacks...`);

                const fallback = resolveFallbackModel(fallbackProviders, primaryModelId);
                if (!fallback || typeof fallback === 'string') {
                    console.error(`[Fallback]: All fallback providers exhausted.`);
                    throw error;
                }

                return await fallback.doGenerate(params as any) as any;
            }
        },

        wrapStream: async ({ doStream, params }) => {
            try {
                return await doStream();
            } catch (error) {
                if (!isAuthOrNetworkError(error)) throw error;

                const errMsg = error instanceof Error ? error.message : String(error);
                console.warn(`[Fallback]: Primary model stream failed: ${errMsg.slice(0, 150)}. Trying fallbacks...`);

                const fallback = resolveFallbackModel(fallbackProviders, primaryModelId);
                if (!fallback || typeof fallback === 'string') {
                    console.error(`[Fallback]: All fallback providers exhausted.`);
                    throw error;
                }

                return await fallback.doStream(params as any) as any;
            }
        },
    };

    return wrapLanguageModel({ model: primary as any, middleware: fallbackMiddleware });
}

