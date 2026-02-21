import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, EmbeddingModel } from 'ai';
import { getConfig } from '../config';
import { createFallbackModel } from './fallback-model';

/** Get OpenRouter app identification headers from config */
function openRouterHeaders() {
    const cfg = getConfig();
    return {
        'HTTP-Referer': cfg.agent.appUrl,
        'X-Title': cfg.agent.appName,
    };
}

/**
 * LLM Configuration
 */
export interface LLMConfig {
    provider: 'openai' | 'ollama' | 'anthropic' | 'google' | 'github' | 'copilot-bridge' | 'openrouter' | 'openai-compatible' | 'custom';
    model: string;
    baseURL?: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    /** Embedding model ID for memory vector search (e.g. "openai/text-embedding-3-small") */
    embeddingModel?: string;
}

/**
 * LLM Client — Lightweight model factory + config management.
 *
 * AI SDK v6 handles generateText/streamText directly, so this class
 * only provides getModel() and config hot-swapping.
 */
export class LLMClient {
    private config: LLMConfig;

    constructor(config: LLMConfig) {
        this.config = config;
    }

    /** Return a copy of the current config */
    getConfig(): LLMConfig {
        return { ...this.config };
    }

    /** Hot-swap the provider/model at runtime */
    updateConfig(patch: Partial<LLMConfig>): LLMConfig {
        this.config = { ...this.config, ...patch };
        // Auto-set baseURL when provider changes
        if (patch.provider && !patch.baseURL) {
            const defaults: Record<string, string> = {
                ollama: 'http://localhost:11434/v1',
                openai: 'https://api.openai.com/v1',
                openrouter: 'https://openrouter.ai/api/v1',
                'copilot-bridge': 'http://localhost:4000/v1',
            };
            if (defaults[patch.provider]) {
                this.config.baseURL = defaults[patch.provider];
            }
        }
        return this.getConfig();
    }

    /** Get the AI SDK model instance for the current config, wrapped with provider fallback. */
    getModel(): LanguageModel {
        return createFallbackModel(this._getModelRaw());
    }

    /** Get the raw AI SDK model instance (no fallback wrapper). */
    private _getModelRaw(): LanguageModel {
        switch (this.config.provider) {
            case 'openai': {
                const p = createOpenAI({
                    baseURL: this.config.baseURL || 'https://api.openai.com/v1',
                    apiKey: this.config.apiKey || getConfig().secrets.openaiApiKey || '',
                });
                // Use .chat() for Chat Completions API (p() defaults to Responses API)
                return p.chat(this.config.model);
            }

            case 'ollama': {
                const p = createOpenAI({
                    baseURL: this.config.baseURL || 'http://localhost:11434/v1',
                    apiKey: 'ollama',
                });
                return p.chat(this.config.model);
            }

            case 'openrouter': {
                const p = createOpenAI({
                    baseURL: 'https://openrouter.ai/api/v1',
                    apiKey: this.config.apiKey || getConfig().secrets.openrouterApiKey || '',
                    headers: openRouterHeaders(),
                });
                return p.chat(this.config.model);
            }

            case 'github': {
                const p = createOpenAI({
                    baseURL: this.config.baseURL || getConfig().secrets.githubApiUrl || 'https://models.inference.ai.azure.com',
                    apiKey: this.config.apiKey || getConfig().secrets.githubApiKey || '',
                });
                return p.chat(this.config.model);
            }

            case 'copilot-bridge': {
                const p = createOpenAI({
                    baseURL: this.config.baseURL || getConfig().secrets.copilotBridgeUrl || 'http://localhost:4000/v1',
                    apiKey: 'copilot-bridge',
                });
                return p.chat(this.config.model);
            }

            case 'openai-compatible': {
                const p = createOpenAI({
                    baseURL: this.config.baseURL || getConfig().secrets.openApiCompatibleApiUrl || 'https://api.openai.com/v1',
                    apiKey: this.config.apiKey || getConfig().secrets.openApiCompatibleApiKey || '',
                });
                return p.chat(this.config.model);
            }

            case 'google': {
                const p = createGoogleGenerativeAI({
                    apiKey: this.config.apiKey || getConfig().secrets.googleApiKey || '',
                });
                return p(this.config.model);
            }

            case 'anthropic': {
                const p = createAnthropic({
                    apiKey: this.config.apiKey || getConfig().secrets.anthropicApiKey || '',
                });
                return p(this.config.model);
            }

            case 'custom': {
                if (!this.config.baseURL) throw new Error('Custom provider requires a baseURL');
                const p = createOpenAI({
                    baseURL: this.config.baseURL,
                    apiKey: this.config.apiKey || 'none',
                });
                return p.chat(this.config.model);
            }

            default:
                throw new Error(`Unsupported provider: ${this.config.provider}`);
        }
    }

    /**
     * Get an AI SDK EmbeddingModel for vector memory search.
     *
     * Uses OpenRouter's /embeddings endpoint with the configured embedding model.
     * Defaults to openai/text-embedding-3-small ($0.02/M tokens — practically free).
     * Returns null if the provider doesn't support embeddings (e.g. ollama).
     */
    getEmbeddingModel(): EmbeddingModel | undefined {
        const embeddingModelId = this.config.embeddingModel || 'openai/text-embedding-3-small';

        switch (this.config.provider) {
            case 'openrouter': {
                const p = createOpenAI({
                    baseURL: 'https://openrouter.ai/api/v1',
                    apiKey: this.config.apiKey || getConfig().secrets.openrouterApiKey || '',
                    headers: openRouterHeaders(),
                });
                return p.embedding(embeddingModelId);
            }

            case 'openai': {
                const p = createOpenAI({
                    baseURL: this.config.baseURL || 'https://api.openai.com/v1',
                    apiKey: this.config.apiKey || getConfig().secrets.openaiApiKey || '',
                });
                return p.embedding(embeddingModelId.replace('openai/', ''));
            }

            case 'github': {
                try {
                    const p = createOpenAI({
                        baseURL: this.config.baseURL || getConfig().secrets.githubApiUrl || 'https://models.inference.ai.azure.com',
                        apiKey: this.config.apiKey || getConfig().secrets.githubApiKey || '',
                    });
                    return p.embedding(embeddingModelId.replace('openai/', ''));
                } catch {
                    return undefined;
                }
            }

            case 'openai-compatible': {
                try {
                    const p = createOpenAI({
                        baseURL: this.config.baseURL || getConfig().secrets.openApiCompatibleApiUrl || 'https://api.openai.com/v1',
                        apiKey: this.config.apiKey || getConfig().secrets.openApiCompatibleApiKey || '',
                    });
                    return p.embedding(embeddingModelId);
                } catch {
                    return undefined;
                }
            }

            case 'custom': {
                if (!this.config.baseURL) return undefined;
                try {
                    const p = createOpenAI({
                        baseURL: this.config.baseURL,
                        apiKey: this.config.apiKey || 'none',
                    });
                    return p.embedding(embeddingModelId);
                } catch {
                    return undefined;
                }
            }

            // Ollama / anthropic don't have a standard embeddings API via @ai-sdk/openai
            default:
                return undefined;
        }
    }
}
