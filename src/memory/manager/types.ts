/**
 * Memory manager types — configuration and shared helper types.
 *
 * @module memory/manager/types
 */

import type { EmbeddingModel } from 'ai';
import type { ConsolidationConfig } from '../consolidator';

// ── Main configuration ─────────────────────────────────

export interface MemoryConfig {
    /** Directory for persistent storage */
    storagePath: string;
    /** AI SDK embedding model (e.g. from OpenRouter) */
    embeddingModel?: EmbeddingModel;
    /** Max recent messages to always include (sliding window) */
    recentWindowSize?: number;
    /** Max relevant old memories to retrieve */
    relevantMemoryLimit?: number;
    /** Max tokens of context to feed into prompts (token-aware) */
    contextBudget?: number;
    /** Callback to generate summaries via LLM */
    summarizer?: (text: string) => Promise<string>;
    /** Callback to extract entities via LLM (returns JSON) */
    entityExtractor?: (prompt: string) => Promise<string>;
    /** Max chunk size for long messages (chars) */
    chunkSize?: number;
    /** Chunk overlap (chars) */
    chunkOverlap?: number;
    /** Consolidation config overrides */
    consolidation?: ConsolidationConfig;
    /** Owner name for knowledge graph identity bootstrap */
    ownerName?: string;
}

// ── Recent message entry ───────────────────────────────

export interface RecentMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}
