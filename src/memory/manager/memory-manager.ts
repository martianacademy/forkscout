/**
 * MemoryManager — thin coordinator for the cognitive memory system.
 *
 * Delegates heavy logic to:
 *   - context-builder.ts  (buildContext)
 *   - self-identity.ts    (getSelfContext, recordSelfObservation, updateEntitySession)
 *   - extraction.ts       (extractEntitiesAsync, extractFactToGraph)
 *   - rag.ts              (chunkText, summarizeCurrentSession)
 *   - search.ts           (searchKnowledge)
 *
 * @module memory/manager/memory-manager
 */

import { VectorStore } from '../vector-store';
import {
    type GraphState, createGraphState,
    initGraph, flushGraph, clearGraph,
    getSelfEntity,
} from '../knowledge-graph';
import { SkillStore } from '../skills';
import { Consolidator } from '../consolidator';
import type { MemoryConfig, RecentMessage } from './types';
import { buildContext, type ContextResult } from './context-builder';
import {
    getSelfContext as _getSelfContext,
    recordSelfObservation as _recordSelfObservation,
    updateEntitySession as _updateEntitySession,
} from './self-identity';
import { extractEntitiesAsync, extractFactToGraph } from './extraction';
import { chunkText, summarizeCurrentSession } from './rag';
import { searchKnowledge, type SearchResult } from './search';

export class MemoryManager {
    private vectorStore: VectorStore;
    private graph: GraphState;
    private skills: SkillStore;
    private consolidator: Consolidator;
    private config: MemoryConfig;
    private sessionId: string;
    private pendingExchange: { user: string } | null = null;
    private exchangeCount = 0;

    /** Current session's recent messages (kept in-memory for fast access) */
    private recentMessages: RecentMessage[] = [];

    constructor(config: MemoryConfig) {
        this.config = {
            recentWindowSize: 6,
            relevantMemoryLimit: 5,
            contextBudget: 4000,
            chunkSize: 1500,
            chunkOverlap: 200,
            ...config,
        };

        this.vectorStore = new VectorStore(
            `${this.config.storagePath}/vectors.json`,
            config.embeddingModel,
        );

        this.graph = createGraphState(
            `${this.config.storagePath}/knowledge-graph.json`,
            config.ownerName,
        );

        this.skills = new SkillStore(
            `${this.config.storagePath}/skills.json`,
        );

        this.consolidator = new Consolidator(config.consolidation);
        this.sessionId = `session_${Date.now()}`;
    }

    // ── Lifecycle ───────────────────────────────────────

    /** Initialize — load persisted memories, graph, and skills. */
    async init(): Promise<void> {
        await Promise.all([
            this.vectorStore.init(),
            initGraph(this.graph),
            this.skills.init(),
        ]);
        getSelfEntity(this.graph);
    }

    /** Flush to disk. */
    async flush(): Promise<void> {
        if (this.pendingExchange) {
            await this.vectorStore.add({
                id: `exchange_${Date.now()}`,
                text: `User: ${this.pendingExchange.user}`,
                exchange: { user: this.pendingExchange.user, assistant: '' },
                timestamp: Date.now(),
                sessionId: this.sessionId,
                type: 'exchange',
            });
            this.pendingExchange = null;
        }

        if (this.exchangeCount >= 3 && this.config.summarizer) {
            await summarizeCurrentSession(this.vectorStore, this.sessionId, this.config.summarizer);
        }

        if (this.consolidator.shouldRun(this.graph)) {
            this.consolidator.consolidate(this.graph, this.skills, this.vectorStore);
        }

        await Promise.all([
            this.vectorStore.flush(),
            flushGraph(this.graph),
            this.skills.flush(),
        ]);
    }

    /** Clear all memory (vector store + knowledge graph + skills). */
    async clear(): Promise<void> {
        this.recentMessages = [];
        this.pendingExchange = null;
        this.exchangeCount = 0;
        await Promise.all([
            this.vectorStore.clear(),
            clearGraph(this.graph),
            this.skills.clear(),
        ]);
    }

    // ── Message handling ────────────────────────────────

    /** Add a message to memory. */
    addMessage(role: 'user' | 'assistant', content: string): void {
        this.recentMessages.push({ role, content, timestamp: new Date() });

        if (role === 'user') {
            this.pendingExchange = { user: content };
        } else if (role === 'assistant' && this.pendingExchange) {
            const exchange = {
                user: this.pendingExchange.user,
                assistant: content,
            };
            const text = `User: ${exchange.user}\nAssistant: ${content.slice(0, 1000)}`;

            const chunks = chunkText(text, this.config.chunkSize, this.config.chunkOverlap);
            for (let i = 0; i < chunks.length; i++) {
                this.vectorStore.add({
                    id: `exchange_${Date.now()}_${i}`,
                    text: chunks[i],
                    exchange: i === 0 ? exchange : undefined,
                    timestamp: Date.now(),
                    sessionId: this.sessionId,
                    type: 'exchange',
                });
            }

            this.pendingExchange = null;
            this.exchangeCount++;

            // Async entity extraction — don't block the response
            extractEntitiesAsync(this.graph, this.config.entityExtractor, exchange.user, content);

            // Periodic consolidation
            if (this.exchangeCount % 10 === 0 && this.consolidator.shouldRun(this.graph)) {
                try { this.consolidator.consolidate(this.graph, this.skills, this.vectorStore); } catch { /* non-critical */ }
            }
        }
    }

    // ── History retrieval ───────────────────────────────

    /** Get recent conversation history (current session sliding window). */
    getRecentHistory(limit?: number): Array<{ role: 'user' | 'assistant'; content: string }> {
        const n = limit ?? this.config.recentWindowSize ?? 6;
        return this.recentMessages.slice(-n).map(({ role, content }) => ({ role, content }));
    }

    /** Get recent history with timestamps (for session context persistence). */
    getRecentHistoryWithTimestamps(limit?: number): RecentMessage[] {
        const n = limit ?? this.config.recentWindowSize ?? 6;
        return this.recentMessages.slice(-n).map(({ role, content, timestamp }) => ({ role, content, timestamp }));
    }

    /** Search for relevant memories across ALL past sessions. */
    async searchHistory(query: string, limit?: number): Promise<Array<{ content: string; similarity: number }>> {
        const n = limit ?? this.config.relevantMemoryLimit ?? 5;
        const results = await this.vectorStore.search(query, n, this.sessionId);
        return results.map(r => ({ content: r.text, similarity: r.score }));
    }

    // ── Context building (delegates to context-builder) ─

    /** Build an optimized context string for the LLM. */
    async buildContext(currentQuery: string): Promise<ContextResult> {
        return buildContext(
            currentQuery,
            this.config,
            this.recentMessages,
            this.graph,
            this.vectorStore,
            this.skills,
            this.sessionId,
        );
    }

    // ── Knowledge operations (delegates to search.ts) ───

    /** Save a knowledge fact explicitly (called by save_knowledge tool). */
    async saveKnowledge(fact: string, category?: string): Promise<void> {
        const prefix = category ? `[${category}] ` : '';
        await this.vectorStore.add({
            id: `knowledge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            text: `${prefix}${fact}`,
            timestamp: Date.now(),
            sessionId: this.sessionId,
            type: 'exchange',
        });
        extractFactToGraph(this.graph, fact, category);
    }

    /** Search knowledge and conversation history (vector + graph). */
    async searchKnowledge(query: string, limit = 5): Promise<SearchResult[]> {
        return searchKnowledge(this.vectorStore, this.graph, query, limit);
    }

    // ── Knowledge graph access ──────────────────────────

    /** Get the knowledge graph state (for graph-specific tools). */
    getGraph(): GraphState { return this.graph; }

    /** Get the skill store instance (for consolidator). */
    getSkills(): SkillStore { return this.skills; }

    /** Get self-identity context for system prompt injection. */
    getSelfContext(): string {
        return _getSelfContext(this.graph);
    }

    /** Record an observation about the agent itself. */
    recordSelfObservation(content: string, source: string = 'self-reflect'): void {
        _recordSelfObservation(this.graph, content, source);
    }

    /** Update a person's entity with the latest conversation context. */
    updateEntitySession(
        entityName: string,
        exchanges: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>,
        channel?: string,
    ): void {
        _updateEntitySession(this.graph, entityName, exchanges, channel);
    }

    // ── Arbitrary data ──────────────────────────────────

    /** Save arbitrary data to memory. */
    async saveData(key: string, value: any): Promise<void> {
        await this.vectorStore.add({
            id: key,
            text: typeof value === 'string' ? value : JSON.stringify(value),
            timestamp: Date.now(),
            sessionId: this.sessionId,
            type: 'exchange',
        });
    }

    /** Retrieve arbitrary data — searches for it. */
    async getData(key: string): Promise<any> {
        const results = await this.vectorStore.search(key, 1);
        return results[0]?.text;
    }
}
