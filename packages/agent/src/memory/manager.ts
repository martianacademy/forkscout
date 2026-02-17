/**
 * Memory Manager — Cognitive memory system with RAG + Knowledge Graph + Skills.
 *
 * Architecture:
 *   1. Recent window — last N exchanges always in context (short-term)
 *   2. Vector store — semantic + keyword search (fuzzy long-term RAG)
 *   3. Knowledge graph — structured entity/relation lookup with cognitive dynamics
 *   4. Skill store — procedural memory (learned workflows)
 *   5. Session summaries — compressed old sessions (ultra long-term)
 *
 * Cognitive dynamics:
 *   - Stage lifecycle: observation → fact → belief → trait
 *   - Evidence-based confidence (confirmations/contradictions)
 *   - Temporal validity (facts can expire)
 *   - Golden rule: LLM writes ONLY stage='observation'
 *
 * Query routing:
 *   - Every query hits vector store + knowledge graph + skill store
 *   - Graph results = deterministic entity facts (high confidence)
 *   - Vector results = fuzzy conversation recall (similarity scored)
 *   - Skill results = relevant learned procedures
 *   - Results are merged, deduplicated, and budget-trimmed
 *
 * Entity extraction:
 *   - After each assistant turn, an LLM call extracts entities + relations
 *   - Extracted data is merged into the knowledge graph (additive, never destructive)
 *   - All extracted data starts at stage='observation' (golden rule)
 *   - Runs async so it doesn't block response streaming
 *
 * Enhanced RAG:
 *   - Long tool outputs / messages are chunked before storage
 *   - Query expansion: important terms extracted for better recall
 */

import { VectorStore } from './vector-store';
import { KnowledgeGraph, buildExtractionPrompt, SELF_ENTITY_NAME, type ExtractedEntities } from './knowledge-graph';
import { SkillStore } from './skills';
import { Consolidator, type ConsolidationConfig } from './consolidator';
import {
    classifySituation, domainBoost, observationDomainBoost,
    buildAccessContext, type LifeDomain,
} from './situation';
import type { EmbeddingModel } from 'ai';
import { countTokens } from '../utils/tokens';

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
}

export class MemoryManager {
    private vectorStore: VectorStore;
    private graph: KnowledgeGraph;
    private skills: SkillStore;
    private consolidator: Consolidator;
    private config: MemoryConfig;
    private sessionId: string;
    private pendingExchange: { user: string } | null = null;
    private exchangeCount = 0;

    /** Current session's recent messages (kept in-memory for fast access) */
    private recentMessages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }> = [];

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

        this.graph = new KnowledgeGraph(
            `${this.config.storagePath}/knowledge-graph.json`,
        );

        this.skills = new SkillStore(
            `${this.config.storagePath}/skills.json`,
        );

        this.consolidator = new Consolidator(config.consolidation);

        this.sessionId = `session_${Date.now()}`;
    }

    /** Initialize — load persisted memories, graph, and skills */
    async init(): Promise<void> {
        await Promise.all([
            this.vectorStore.init(),
            this.graph.init(),
            this.skills.init(),
        ]);

        // Seed self-identity entity (idempotent — creates only if missing)
        this.graph.getSelfEntity();
    }

    /** Flush to disk */
    async flush(): Promise<void> {
        // Store pending exchange
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

        // Summarize current session if we have enough exchanges
        if (this.exchangeCount >= 3 && this.config.summarizer) {
            await this.summarizeCurrentSession();
        }

        // Run consolidation if enough mutations have accumulated
        if (this.consolidator.shouldRun(this.graph)) {
            this.consolidator.consolidate(this.graph, this.skills, this.vectorStore);
        }

        await Promise.all([
            this.vectorStore.flush(),
            this.graph.flush(),
            this.skills.flush(),
        ]);
    }

    /** Add a message to memory */
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

            // Chunk long exchanges before storing
            const chunks = this.chunkText(text);

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
            this.extractEntitiesAsync(exchange.user, content);

            // Check if consolidation should run (lightweight check)
            if (this.exchangeCount % 10 === 0 && this.consolidator.shouldRun(this.graph)) {
                // Run async to not block the response
                try { this.consolidator.consolidate(this.graph, this.skills, this.vectorStore); } catch { /* non-critical */ }
            }
        }
    }

    /** Get recent conversation history (current session sliding window) */
    getRecentHistory(limit?: number): Array<{ role: 'user' | 'assistant'; content: string }> {
        const n = limit ?? this.config.recentWindowSize ?? 6;
        return this.recentMessages
            .slice(-n)
            .map(({ role, content }) => ({ role, content }));
    }

    /** Search for relevant memories across ALL past sessions */
    async searchHistory(query: string, limit?: number): Promise<Array<{ content: string; similarity: number }>> {
        const n = limit ?? this.config.relevantMemoryLimit ?? 5;
        const results = await this.vectorStore.search(query, n, this.sessionId);
        return results.map(r => ({
            content: r.text,
            similarity: r.score,
        }));
    }

    /**
     * Build an optimized context string for the LLM.
     * Combines:
     *   1. Recent sliding window (always included)
     *   2. Knowledge graph facts (deterministic entity lookup)
     *   3. Relevant old memories from vector store (fuzzy search)
     * All capped to the context budget.
     */
    async buildContext(currentQuery: string): Promise<{
        recentHistory: string;
        relevantMemories: string;
        graphContext: string;
        skillContext: string;
        stats: {
            recentCount: number; retrievedCount: number; graphEntities: number;
            totalChunks: number; skillCount: number;
            situation: { primary: LifeDomain[]; goal: string };
        };
    }> {
        const budgetTokens = this.config.contextBudget ?? 4000;
        let remainingTokens = budgetTokens;

        // 0. Classify the current situation (domain lens)
        const recent = this.getRecentHistory();
        const recentTexts = recent.map(r => r.content);

        // Gather active entity types from recent graph hits
        const preflightHits = this.graph.search(currentQuery, 3);
        const activeEntityTypes = preflightHits.map(h => h.entity.type);

        const situation = classifySituation(currentQuery, recentTexts, activeEntityTypes);
        const accessCtx = buildAccessContext(currentQuery, situation);

        // 1. Recent sliding window (always included, highest priority)
        const recentStr = recent
            .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
            .join('\n');
        remainingTokens -= countTokens(recentStr);

        // 2. Knowledge graph lookup with domain-aware re-ranking
        let graphStr = '';
        let graphEntities = 0;
        if (remainingTokens > 50) {
            const graphBudgetTokens = Math.min(Math.floor(remainingTokens * 0.4), 600);
            // Approximate char budget from token budget (1 token ≈ 4 chars)
            const graphBudgetChars = graphBudgetTokens * 4;
            const graphResults = this.graph.search(currentQuery, 8);

            if (graphResults.length > 0) {
                // Domain-aware re-ranking
                for (const result of graphResults) {
                    const entityBoost = domainBoost(result.entity.type, situation);

                    // Also boost/suppress based on observation content alignment
                    let obsBoostSum = 0;
                    for (const obs of result.entity.observations) {
                        obsBoostSum += observationDomainBoost(obs.content, situation);
                    }
                    const avgObsBoost = result.entity.observations.length > 0
                        ? obsBoostSum / result.entity.observations.length
                        : 1.0;

                    result.score *= entityBoost * avgObsBoost;

                    // Update access context with domain info
                    result.entity.lastAccessContext = accessCtx;
                }

                // Re-sort and trim
                graphResults.sort((a, b) => b.score - a.score);
                const topResults = graphResults.slice(0, 5);

                graphStr = '\n\n' + this.graph.formatForContext(topResults, graphBudgetChars);
                graphEntities = topResults.length;
                remainingTokens -= countTokens(graphStr);
            }
        }

        // 3. Vector store search with query expansion (fuzzy — fills remaining budget)
        let relevantStr = '';
        let retrievedCount = 0;
        if (remainingTokens > 50) {
            const expandedQuery = this.expandQuery(currentQuery);
            const relevant = await this.searchHistory(expandedQuery);
            const filtered: string[] = [];

            for (const mem of relevant) {
                const isInRecent = recent.some(r =>
                    mem.content.includes(r.content.slice(0, 50))
                );
                if (isInRecent) continue;

                const entry = `[Memory (${(mem.similarity * 100).toFixed(0)}%)]: ${mem.content}`;
                const entryTokens = countTokens(entry);
                if (remainingTokens - entryTokens < 0) break;
                filtered.push(entry);
                remainingTokens -= entryTokens;
                retrievedCount++;
            }

            if (filtered.length > 0) {
                relevantStr = '\n\nRelevant memories from past conversations:\n' + filtered.join('\n');
            }
        }

        // 4. Skill store lookup (procedural memory)
        let skillStr = '';
        let skillCount = 0;
        if (remainingTokens > 50) {
            const relevantSkills = this.skills.findByIntent(currentQuery, 3);
            if (relevantSkills.length > 0) {
                // Approximate char budget from token budget
                const skillBudgetChars = Math.min(remainingTokens * 4, 1000);
                skillStr = '\n\n' + this.skills.formatForContext(relevantSkills, skillBudgetChars);
                skillCount = relevantSkills.length;
                remainingTokens -= countTokens(skillStr);
            }
        }

        return {
            recentHistory: recentStr,
            relevantMemories: relevantStr,
            graphContext: graphStr,
            skillContext: skillStr,
            stats: {
                recentCount: recent.length,
                retrievedCount,
                graphEntities,
                totalChunks: this.vectorStore.size,
                skillCount,
                situation: {
                    primary: situation.primary,
                    goal: situation.goal,
                },
            },
        };
    }

    /**
     * Save a knowledge fact explicitly (called by save_knowledge tool).
     * This is for the agent to store structured facts, user preferences,
     * project context, etc. that should persist across sessions.
     */
    async saveKnowledge(fact: string, category?: string): Promise<void> {
        const prefix = category ? `[${category}] ` : '';

        // Store in vector store for fuzzy retrieval
        await this.vectorStore.add({
            id: `knowledge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            text: `${prefix}${fact}`,
            timestamp: Date.now(),
            sessionId: this.sessionId,
            type: 'exchange',
        });

        // Also extract entity from the fact for graph storage
        this.extractFactToGraph(fact, category);
    }

    /**
     * Search knowledge and conversation history.
     * Searches BOTH vector store and knowledge graph, merges results.
     */
    async searchKnowledge(query: string, limit = 5): Promise<Array<{ content: string; relevance: number; source: 'vector' | 'graph' }>> {
        const [vectorResults, graphResults] = await Promise.all([
            this.vectorStore.search(query, limit),
            Promise.resolve(this.graph.search(query, limit)),
        ]);

        const results: Array<{ content: string; relevance: number; source: 'vector' | 'graph' }> = [];

        // Graph results first (deterministic, high confidence)
        for (const gr of graphResults) {
            const observations = gr.entity.observations.join('; ');
            const connections = gr.neighbors.slice(0, 3).map(n =>
                `${n.direction === 'outgoing' ? '→' : '←'} ${n.relation.type} ${n.entity.name}`
            ).join(', ');
            const content = `[${gr.entity.type}] ${gr.entity.name}: ${observations}${connections ? ` (${connections})` : ''}`;
            results.push({ content, relevance: Math.round(gr.score * 100), source: 'graph' });
        }

        // Vector results (fuzzy, scored)
        for (const vr of vectorResults) {
            const alreadyCovered = results.some(r =>
                r.source === 'graph' && vr.text.toLowerCase().includes(r.content.split(':')[1]?.trim().slice(0, 30).toLowerCase() || '__none__')
            );
            if (alreadyCovered) continue;

            results.push({
                content: vr.text,
                relevance: Math.round(vr.score * 100),
                source: 'vector',
            });
        }

        results.sort((a, b) => b.relevance - a.relevance);
        return results.slice(0, limit);
    }

    // ── Knowledge Graph Direct Access ─────────────────

    /** Get the knowledge graph instance (for graph-specific tools) */
    getGraph(): KnowledgeGraph { return this.graph; }

    /** Get the skill store instance (for consolidator) */
    getSkills(): SkillStore { return this.skills; }

    /**
     * Get self-identity context — the agent's observations about itself.
     * Injected into every system prompt so the agent remembers who it is.
     */
    getSelfContext(): string {
        const self = this.graph.getSelfEntity();
        if (self.observations.length === 0) return '';

        // Group by stage for priority display (traits > beliefs > facts > observations)
        const byStage = new Map<string, string[]>();
        for (const obs of self.observations) {
            const list = byStage.get(obs.stage) || [];
            list.push(obs.content);
            byStage.set(obs.stage, list);
        }

        const lines: string[] = [];
        for (const stage of ['trait', 'belief', 'fact', 'episode', 'observation'] as const) {
            const items = byStage.get(stage);
            if (items) {
                for (const item of items) {
                    lines.push(`- ${item}`);
                }
            }
        }

        // Include self-relations
        const selfRelations = this.graph.getAllRelations()
            .filter(r => r.from.toLowerCase() === SELF_ENTITY_NAME.toLowerCase()
                || r.to.toLowerCase() === SELF_ENTITY_NAME.toLowerCase());

        if (selfRelations.length > 0) {
            const relLines = selfRelations.map(r =>
                r.from.toLowerCase() === SELF_ENTITY_NAME.toLowerCase()
                    ? `- I ${r.type} ${r.to}`
                    : `- ${r.from} ${r.type} me`
            );
            lines.push(...relLines);
        }

        return lines.join('\n');
    }

    /** Record an observation about the agent itself */
    recordSelfObservation(content: string, source: string = 'self-reflect'): void {
        this.graph.addSelfObservation(content, source);
    }

    // ── Entity Extraction ─────────────────────────────

    /**
     * Extract entities from a conversation exchange using LLM.
     * Runs async (fire-and-forget) so it doesn't block streaming.
     */
    private extractEntitiesAsync(userMessage: string, assistantMessage: string): void {
        if (!this.config.entityExtractor) return;

        // Skip trivial exchanges
        if (userMessage.length < 20 && assistantMessage.length < 50) return;

        const prompt = buildExtractionPrompt(userMessage, assistantMessage);

        this.config.entityExtractor(prompt)
            .then(jsonStr => {
                try {
                    const cleaned = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
                    const extracted: ExtractedEntities = JSON.parse(cleaned);

                    if (extracted.entities.length > 0 || extracted.relations.length > 0) {
                        const { newEntities, newRelations } = this.graph.mergeExtracted(extracted);
                        if (newEntities > 0 || newRelations > 0) {
                            console.log(`🔗 Graph updated: +${newEntities} entities, +${newRelations} relations`);
                        }
                    }
                } catch {
                    // JSON parse failed — ignore silently
                }
            })
            .catch(() => {
                // Extraction error — non-critical, ignore
            });
    }

    /**
     * Simple heuristic extraction for explicit save_knowledge calls.
     * No LLM needed — pattern matching for common fact formats.
     */
    private extractFactToGraph(fact: string, category?: string): void {
        // Pattern: "User prefers X over Y"
        const prefersMatch = fact.match(/(?:user|i)\s+prefers?\s+(.+?)\s+(?:over|instead of|rather than)\s+(.+)/i);
        if (prefersMatch) {
            this.graph.addEntity(prefersMatch[1].trim(), 'preference', [fact]);
            this.graph.addEntity(prefersMatch[2].trim(), 'technology', [`Not preferred: ${fact}`]);
            this.graph.addRelation(prefersMatch[1].trim(), prefersMatch[2].trim(), 'preferred_over');
            return;
        }

        // Pattern: "Project uses X"
        const usesMatch = fact.match(/(?:project|app|system|codebase)\s+uses?\s+(.+)/i);
        if (usesMatch) {
            const tech = usesMatch[1].replace(/[.!]+$/, '').trim();
            this.graph.addEntity(tech, 'technology', [fact]);
            return;
        }

        // Pattern: "X is Y" — generic entity creation
        const isMatch = fact.match(/^(.{2,30})\s+(?:is|are)\s+(.+)/i);
        if (isMatch) {
            const entityType = category === 'user-preference' ? 'preference'
                : category === 'project-context' ? 'project'
                    : category === 'technical-note' ? 'technology'
                        : 'other';
            this.graph.addEntity(isMatch[1].trim(), entityType as any, [fact]);
            return;
        }

        // Fallback: create entity from category
        if (category) {
            const entityType = category === 'user-preference' ? 'preference'
                : category === 'project-context' ? 'project'
                    : category === 'technical-note' ? 'technology'
                        : 'other';
            const name = fact.split(/[,.:;!?]/)[0].trim().slice(0, 50);
            if (name.length > 3) {
                this.graph.addEntity(name, entityType as any, [fact]);
            }
        }
    }

    // ── Enhanced RAG: Chunking ────────────────────────

    /**
     * Split long text into overlapping chunks for better retrieval.
     */
    private chunkText(text: string): string[] {
        const maxSize = this.config.chunkSize ?? 1500;
        const overlap = this.config.chunkOverlap ?? 200;

        if (text.length <= maxSize) return [text];

        const chunks: string[] = [];
        let start = 0;

        while (start < text.length) {
            let end = start + maxSize;

            // Try to break at a sentence boundary
            if (end < text.length) {
                const breakPoints = ['. ', '.\n', '\n\n', '\n', '; ', ', '];
                for (const bp of breakPoints) {
                    const breakAt = text.lastIndexOf(bp, end);
                    if (breakAt > start + maxSize * 0.5) {
                        end = breakAt + bp.length;
                        break;
                    }
                }
            }

            chunks.push(text.slice(start, end));
            start = end - overlap;

            if (text.length - start < overlap) {
                if (chunks.length > 0) {
                    chunks[chunks.length - 1] = text.slice(start - (end - start) + overlap);
                }
                break;
            }
        }

        return chunks;
    }

    // ── Enhanced RAG: Query Expansion ─────────────────

    /**
     * Expand a query with additional search terms for better vector recall.
     */
    private expandQuery(query: string): string {
        if (query.split(/\s+/).length <= 5) return query;

        const techTerms = query.match(/\b[A-Z][a-zA-Z]+(?:\.[a-zA-Z]+)*\b/g) || [];
        const quotedTerms = query.match(/"([^"]+)"/g)?.map(t => t.replace(/"/g, '')) || [];

        const extras = [...new Set([...techTerms, ...quotedTerms])].slice(0, 5);
        if (extras.length === 0) return query;

        return `${query} ${extras.join(' ')}`;
    }

    /** Summarize current session exchanges into a compressed chunk */
    private async summarizeCurrentSession(): Promise<void> {
        if (!this.config.summarizer) return;

        const sessionChunks = this.vectorStore.getSession(this.sessionId)
            .filter(c => c.type === 'exchange');

        if (sessionChunks.length < 3) return;

        const exchangeText = sessionChunks
            .map(c => c.text)
            .join('\n---\n')
            .slice(0, 3000);

        try {
            const summary = await this.config.summarizer(exchangeText);
            await this.vectorStore.add({
                id: `summary_${this.sessionId}`,
                text: `[Session summary]: ${summary}`,
                summary,
                timestamp: Date.now(),
                sessionId: this.sessionId,
                type: 'summary',
            });
            console.log(`📋 Session summary saved (${sessionChunks.length} exchanges → 1 summary)`);
        } catch {
            // Summarization failed — raw exchanges are still there
        }
    }

    /** Clear all memory (vector store + knowledge graph + skills) */
    async clear(): Promise<void> {
        this.recentMessages = [];
        this.pendingExchange = null;
        this.exchangeCount = 0;
        await Promise.all([
            this.vectorStore.clear(),
            this.graph.clear(),
            this.skills.clear(),
        ]);
    }

    /** Save arbitrary data to memory */
    async saveData(key: string, value: any): Promise<void> {
        await this.vectorStore.add({
            id: key,
            text: typeof value === 'string' ? value : JSON.stringify(value),
            timestamp: Date.now(),
            sessionId: this.sessionId,
            type: 'exchange',
        });
    }

    /** Retrieve arbitrary data — searches for it */
    async getData(key: string): Promise<any> {
        const results = await this.vectorStore.search(key, 1);
        return results[0]?.text;
    }
}
