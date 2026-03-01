// src/channels/history-embeddings.ts — Per-session vector embeddings for chat history search.
//
// Chunks conversation history into "turns" (user msg + assistant/tool response),
// embeds each turn via an embedding model, stores vectors alongside the chat,
// and provides semantic search over the full history.
//
// Storage layout:
//   .agents/chats/<sessionKey>/embeddings.json
//
// The embedding store tracks which messages have been embedded (lastMsgIdx)
// so new turns are embedded incrementally — no full re-index on each message.
//
// Usage:
//   embedNewTurns(sessionKey, messages) → embed any unembedded turns
//   searchHistory(query, sessionKey)    → semantic search across all turns
//   backfillEmbeddings(sessionKey)      → full re-index from scratch

import { embed, embedMany, cosineSimilarity } from "ai";
import type { EmbeddingModel, ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { encode } from "gpt-tokenizer";
import { LOG_DIR } from "@/logs/activity-log.ts";
import { getConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";

const logger = log("history-embeddings");
const CHATS_DIR = resolve(LOG_DIR, "chats");

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface EmbeddingConfig {
    /** Enable/disable the embedding system. Default: true. */
    enabled: boolean;
    /** Provider for embeddings. Uses its own provider instance, not the chat provider. */
    provider: "openrouter" | "google";
    /** Embedding model ID (provider-specific). */
    model: string;
    /** Number of top results to return from search. Default: 5. */
    topK: number;
    /** Max tokens per chunk text before truncation. Default: 500. */
    chunkMaxTokens: number;
}

interface HistoryChunk {
    /** Searchable text representation of this conversation turn. */
    text: string;
    /** Start index in the full history array. */
    msgStartIdx: number;
    /** End index (exclusive) in the full history array. */
    msgEndIdx: number;
}

interface EmbeddedChunk extends HistoryChunk {
    /** Vector embedding of the text. */
    embedding: number[];
}

interface EmbeddingStore {
    /** Model ID used for embeddings — if changed, triggers full re-index. */
    modelId: string;
    /** Number of messages from history.json that have been processed. */
    lastMsgIdx: number;
    /** All embedded chunks. */
    chunks: EmbeddedChunk[];
}

export interface SearchResult {
    /** The text that was embedded (turn summary). */
    text: string;
    /** Cosine similarity score (0–1). */
    score: number;
    /** Index range in the original history. */
    msgStartIdx: number;
    msgEndIdx: number;
}

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────

function embeddingsPath(sessionKey: string): string {
    return resolve(CHATS_DIR, sessionKey, "embeddings.json");
}

function loadStore(sessionKey: string): EmbeddingStore {
    const path = embeddingsPath(sessionKey);
    if (!existsSync(path)) return { modelId: "", lastMsgIdx: 0, chunks: [] };
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
        return { modelId: "", lastMsgIdx: 0, chunks: [] };
    }
}

function saveStore(sessionKey: string, store: EmbeddingStore): void {
    const dir = resolve(CHATS_DIR, sessionKey);
    mkdirSync(dir, { recursive: true });
    writeFileSync(embeddingsPath(sessionKey), JSON.stringify(store));
}

// ─────────────────────────────────────────────
// Embedding model factory
// ─────────────────────────────────────────────

let _embeddingModel: EmbeddingModel | null = null;
let _embeddingModelId: string = "";

function getEmbeddingModel(): EmbeddingModel {
    const config = getConfig();
    const embCfg = config.embeddings ?? {
        enabled: true,
        provider: "openrouter",
        model: "openai/text-embedding-3-small",
        topK: 5,
        chunkMaxTokens: 500,
    };

    const cacheKey = `${embCfg.provider}/${embCfg.model}`;
    if (_embeddingModel && _embeddingModelId === cacheKey) return _embeddingModel;

    switch (embCfg.provider) {
        case "openrouter": {
            const { agent } = getConfig();
            const provider = createOpenAI({
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: process.env.OPENROUTER_API_KEY ?? "",
                name: "openrouter-embed",
                headers: {
                    "HTTP-Referer": agent.github,
                    "X-Title": agent.name,
                },
            });
            _embeddingModel = provider.embeddingModel(embCfg.model) as EmbeddingModel;
            break;
        }
        case "google": {
            const provider = createGoogleGenerativeAI({
                apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "",
            });
            _embeddingModel = provider.embeddingModel(embCfg.model as any) as EmbeddingModel;
            break;
        }
        default:
            throw new Error(`Unsupported embedding provider: ${embCfg.provider}`);
    }

    _embeddingModelId = cacheKey;
    return _embeddingModel;
}

function getEmbeddingConfig(): EmbeddingConfig {
    const config = getConfig();
    return config.embeddings ?? {
        enabled: true,
        provider: "openrouter",
        model: "openai/text-embedding-3-small",
        topK: 5,
        chunkMaxTokens: 500,
    };
}

// ─────────────────────────────────────────────
// Chunking — group messages into conversation turns
// ─────────────────────────────────────────────

/**
 * Extract a text representation from a ModelMessage for embedding.
 */
function messageToText(msg: ModelMessage): string {
    if (typeof msg.content === "string") return msg.content;
    if (!Array.isArray(msg.content)) return "";
    return (msg.content as any[]).map((part: any) => {
        if (part.type === "text") return part.text ?? "";
        if (part.type === "tool-call") return `[tool: ${part.toolName}]`;
        if (part.type === "tool-result") {
            const out = part.output;
            let raw: string;
            if (typeof out === "string") raw = out;
            else if (out?.type === "text") raw = out.value ?? "";
            else if (out?.type === "json") raw = JSON.stringify(out.value ?? {});
            else raw = JSON.stringify(out ?? "");
            // Truncate long tool results
            return `[tool-result: ${raw.slice(0, 300)}]`;
        }
        return "";
    }).filter(Boolean).join(" ");
}

/**
 * Chunk a message array into conversation turns.
 * Each turn starts with a user message and includes all assistant/tool messages
 * until the next user message.
 *
 * @param messages  Full history array
 * @param startIdx  Start processing from this index (for incremental)
 * @param maxTokens Max tokens per chunk text
 */
export function chunkHistory(
    messages: ModelMessage[],
    startIdx: number = 0,
    maxTokens: number = 500
): HistoryChunk[] {
    const chunks: HistoryChunk[] = [];
    let i = startIdx;

    // Skip to the first user message from startIdx
    while (i < messages.length && (messages[i] as any).role !== "user") i++;

    while (i < messages.length) {
        const turnStart = i;
        const parts: string[] = [];

        // User message
        const userText = messageToText(messages[i]);
        if (userText) parts.push(`User: ${userText}`);
        i++;

        // Collect assistant/tool messages until next user message
        const toolNames: string[] = [];
        let assistantText = "";
        while (i < messages.length && (messages[i] as any).role !== "user") {
            const msg = messages[i];
            const role = (msg as any).role;
            if (role === "assistant") {
                const text = messageToText(msg);
                if (text) assistantText += (assistantText ? " " : "") + text;
            } else if (role === "tool") {
                // Just note tool names — full results are too long
                const text = messageToText(msg);
                if (text) {
                    const toolMatch = text.match(/\[tool-result: /);
                    if (toolMatch) toolNames.push(text.slice(0, 100));
                }
            }
            i++;
        }

        if (assistantText) parts.push(`Assistant: ${assistantText}`);
        if (toolNames.length > 0) parts.push(`Tools used: ${toolNames.length}`);

        let text = parts.join("\n");

        // Truncate to max tokens
        const tokens = encode(text);
        if (tokens.length > maxTokens) {
            // Rough char estimate: 4 chars/token
            text = text.slice(0, maxTokens * 4);
        }

        if (text.trim()) {
            chunks.push({ text, msgStartIdx: turnStart, msgEndIdx: i });
        }
    }

    return chunks;
}

// ─────────────────────────────────────────────
// Serialization lock — prevent concurrent embeddings per session
// ─────────────────────────────────────────────
const _locks = new Map<string, Promise<void>>();

function withLock(sessionKey: string, fn: () => Promise<void>): Promise<void> {
    const prev = _locks.get(sessionKey) ?? Promise.resolve();
    const next = prev.then(fn, fn); // always run, even if previous failed
    _locks.set(sessionKey, next);
    return next;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Embed any new conversation turns that haven't been embedded yet.
 * Call this after appending new messages to history.
 * Safe to call frequently — only processes new turns.
 * Fire-and-forget safe — errors are logged, not thrown.
 */
export function embedNewTurns(sessionKey: string, messages: ModelMessage[]): void {
    const cfg = getEmbeddingConfig();
    if (!cfg.enabled) return;

    // Fire and forget — don't block the caller
    withLock(sessionKey, async () => {
        try {
            const store = loadStore(sessionKey);
            const modelId = `${cfg.provider}/${cfg.model}`;

            // Model changed — need full re-index
            if (store.modelId && store.modelId !== modelId) {
                logger.info(`Embedding model changed (${store.modelId} → ${modelId}), re-indexing ${sessionKey}`);
                store.chunks = [];
                store.lastMsgIdx = 0;
            }

            // Nothing new to embed
            if (store.lastMsgIdx >= messages.length) return;

            // Find new complete turns (only turns where the next user msg has arrived)
            const newChunks = chunkHistory(messages, store.lastMsgIdx, cfg.chunkMaxTokens);
            if (newChunks.length === 0) return;

            // Embed all new chunks in batch
            const model = getEmbeddingModel();
            const texts = newChunks.map(c => c.text);

            const { embeddings } = await embedMany({
                model,
                values: texts,
                maxRetries: 2,
            });

            // Merge into store
            const embeddedChunks: EmbeddedChunk[] = newChunks.map((chunk, idx) => ({
                ...chunk,
                embedding: embeddings[idx],
            }));

            store.chunks.push(...embeddedChunks);
            store.lastMsgIdx = newChunks[newChunks.length - 1].msgEndIdx;
            store.modelId = modelId;

            saveStore(sessionKey, store);
            logger.info(`Embedded ${embeddedChunks.length} new turns for ${sessionKey} (total: ${store.chunks.length})`);
        } catch (err: any) {
            logger.error(`Failed to embed turns for ${sessionKey}:`, err.message ?? err);
        }
    });
}

/**
 * Semantic search across embedded chat history.
 *
 * @param query       Natural language search query
 * @param sessionKey  Chat session to search
 * @param topK        Number of results (default from config)
 * @returns           Top-K matching turns with scores
 */
export async function searchHistory(
    query: string,
    sessionKey: string,
    topK?: number
): Promise<SearchResult[]> {
    const cfg = getEmbeddingConfig();
    if (!cfg.enabled) return [];

    const store = loadStore(sessionKey);
    if (store.chunks.length === 0) return [];

    const k = topK ?? cfg.topK;

    // Embed the query
    const model = getEmbeddingModel();
    const { embedding: queryEmbedding } = await embed({
        model,
        value: query,
        maxRetries: 2,
    });

    // Score all chunks
    const scored = store.chunks.map((chunk) => ({
        text: chunk.text,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        msgStartIdx: chunk.msgStartIdx,
        msgEndIdx: chunk.msgEndIdx,
    }));

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
}

/**
 * Full re-index: delete existing embeddings and re-embed all turns from scratch.
 * Useful when model changes or history was modified.
 */
export async function backfillEmbeddings(
    sessionKey: string,
    messages: ModelMessage[]
): Promise<{ chunksEmbedded: number; totalTokens: number }> {
    const cfg = getEmbeddingConfig();
    if (!cfg.enabled) return { chunksEmbedded: 0, totalTokens: 0 };

    const modelId = `${cfg.provider}/${cfg.model}`;
    const allChunks = chunkHistory(messages, 0, cfg.chunkMaxTokens);

    if (allChunks.length === 0) {
        saveStore(sessionKey, { modelId, lastMsgIdx: messages.length, chunks: [] });
        return { chunksEmbedded: 0, totalTokens: 0 };
    }

    logger.info(`Backfilling ${allChunks.length} turns for ${sessionKey}...`);

    const model = getEmbeddingModel();
    const BATCH_SIZE = 256; // OpenAI limit per batch
    const embeddedChunks: EmbeddedChunk[] = [];
    let totalTokens = 0;

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE);
        const texts = batch.map(c => c.text);

        const { embeddings, usage } = await embedMany({
            model,
            values: texts,
            maxRetries: 2,
        });

        totalTokens += usage?.tokens ?? 0;

        for (let j = 0; j < batch.length; j++) {
            embeddedChunks.push({ ...batch[j], embedding: embeddings[j] });
        }

        logger.info(`  Backfill batch ${Math.floor(i / BATCH_SIZE) + 1}: embedded ${batch.length} chunks`);
    }

    const store: EmbeddingStore = {
        modelId,
        lastMsgIdx: allChunks[allChunks.length - 1].msgEndIdx,
        chunks: embeddedChunks,
    };
    saveStore(sessionKey, store);

    logger.info(`Backfill complete: ${embeddedChunks.length} chunks, ~${totalTokens} tokens`);
    return { chunksEmbedded: embeddedChunks.length, totalTokens };
}

/**
 * Get embedding stats for a session (no API calls).
 */
export function getEmbeddingStats(sessionKey: string): {
    totalChunks: number;
    lastMsgIdx: number;
    modelId: string;
} {
    const store = loadStore(sessionKey);
    return {
        totalChunks: store.chunks.length,
        lastMsgIdx: store.lastMsgIdx,
        modelId: store.modelId,
    };
}
