/**
 * Vector Store — semantic search using AI SDK embeddings via OpenRouter.
 * Falls back to BM25-style keyword scoring if embeddings are unavailable.
 */

import { embed, embedMany, type EmbeddingModel } from 'ai';

import type { MemoryStage } from './knowledge-graph';
import type { AccessContext } from './situation';

/** A stored memory chunk with optional embedding */
export interface MemoryChunk {
    id: string;
    text: string;
    /** Conversation exchange: user message + assistant response */
    exchange?: { user: string; assistant: string };
    /** Summary of a group of exchanges */
    summary?: string;
    /** Embedding vector (if available) */
    embedding?: number[];
    /** When this chunk was created */
    timestamp: number;
    /** Session ID this chunk belongs to */
    sessionId: string;
    /** Whether this is a session summary vs a raw exchange */
    type: 'exchange' | 'summary';
    /** Cognitive lifecycle stage */
    stage: MemoryStage;
    /** Importance score (0-1), set by consolidator or heuristic */
    importance: number;
    /** How many times this chunk was returned in search results */
    accessCount: number;
    /** When this chunk was last retrieved */
    lastAccessed: number;
    /** Whether this has been processed by the consolidator */
    consolidated: boolean;
    /** Last access context — what query + domains triggered retrieval */
    lastAccessContext?: AccessContext;
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}

/** BM25-style keyword scoring (no embeddings needed) */
function bm25Score(query: string, document: string): number {
    const k1 = 1.5;
    const b = 0.75;
    const avgDocLen = 200;

    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const docTerms = document.toLowerCase().split(/\s+/);
    const docLen = docTerms.length;

    const tf = new Map<string, number>();
    for (const term of docTerms) {
        tf.set(term, (tf.get(term) || 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
        const freq = tf.get(term) || 0;
        if (freq === 0) continue;
        const numerator = freq * (k1 + 1);
        const denominator = freq + k1 * (1 - b + b * (docLen / avgDocLen));
        score += numerator / denominator;
    }

    return queryTerms.length > 0 ? score / queryTerms.length : 0;
}

/**
 * VectorStore — stores chunks with embeddings, supports hybrid search.
 *
 * Uses AI SDK `embed()` / `embedMany()` with any EmbeddingModel (e.g. OpenRouter).
 * Falls back to BM25 keyword scoring if no embedding model is provided or if
 * embedding calls fail.
 */
export class VectorStore {
    private chunks: MemoryChunk[] = [];
    private embeddingModel: EmbeddingModel | null;
    private embeddingsAvailable = false;
    private filePath: string;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(filePath: string, embeddingModel?: EmbeddingModel) {
        this.filePath = filePath;
        this.embeddingModel = embeddingModel ?? null;
    }

    async init(): Promise<void> {
        // Load existing chunks from disk
        try {
            const fs = await import('fs/promises');
            const raw = await fs.readFile(this.filePath, 'utf-8');
            this.chunks = JSON.parse(raw);
        } catch {
            this.chunks = [];
        }

        // Probe the embedding model with a test call
        if (this.embeddingModel) {
            try {
                await embed({ model: this.embeddingModel, value: 'test' });
                this.embeddingsAvailable = true;
                console.log('🧠 Vector embeddings enabled (OpenRouter)');

                // Embed any chunks that don't have embeddings yet
                const needsEmbedding = this.chunks.filter(c => !c.embedding);
                if (needsEmbedding.length > 0) {
                    console.log(`   Embedding ${needsEmbedding.length} existing chunks...`);
                    try {
                        const texts = needsEmbedding.map(c => c.text.slice(0, 2000));
                        const { embeddings } = await embedMany({ model: this.embeddingModel, values: texts });
                        for (let i = 0; i < needsEmbedding.length; i++) {
                            needsEmbedding[i].embedding = embeddings[i];
                        }
                        this.scheduleSave();
                    } catch {
                        console.log('   ⚠️ Failed to embed existing chunks, will use keyword search');
                    }
                }
            } catch {
                this.embeddingsAvailable = false;
                console.log('⚠️ Embedding model unavailable, using keyword-based memory search');
            }
        } else {
            console.log('🔤 No embedding model configured, using keyword-based memory search');
        }

        console.log(`📝 Loaded ${this.chunks.length} memory chunks`);
    }

    /** Add a chunk to the store */
    async add(chunk: Omit<MemoryChunk, 'embedding' | 'stage' | 'importance' | 'accessCount' | 'lastAccessed' | 'consolidated'> & Partial<Pick<MemoryChunk, 'stage' | 'importance' | 'accessCount' | 'lastAccessed' | 'consolidated'>>): Promise<void> {
        const fullChunk: MemoryChunk = {
            stage: 'observation',
            importance: chunk.type === 'summary' ? 0.7 : 0.5,
            accessCount: 0,
            lastAccessed: 0,
            consolidated: false,
            ...chunk,
        };

        if (this.embeddingsAvailable && this.embeddingModel) {
            try {
                const { embedding } = await embed({
                    model: this.embeddingModel,
                    value: chunk.text.slice(0, 2000),
                });
                fullChunk.embedding = embedding;
            } catch {
                // Embedding failed — store without it
            }
        }

        this.chunks.push(fullChunk);
        this.scheduleSave();
    }

    /**
     * Hybrid search — combines vector similarity with BM25 keyword scoring.
     * Returns top-K most relevant chunks.
     */
    async search(query: string, limit = 5, excludeSessionId?: string): Promise<Array<MemoryChunk & { score: number }>> {
        if (this.chunks.length === 0) return [];

        let queryEmbedding: number[] | null = null;
        if (this.embeddingsAvailable && this.embeddingModel) {
            try {
                const { embedding } = await embed({
                    model: this.embeddingModel,
                    value: query,
                });
                queryEmbedding = embedding;
            } catch {
                // Fall back to keyword only
            }
        }

        const scored = this.chunks
            .filter(c => !excludeSessionId || c.sessionId !== excludeSessionId)
            .map(chunk => {
                let score = 0;

                // Vector similarity (weight: 0.7)
                if (queryEmbedding && chunk.embedding) {
                    score += cosineSimilarity(queryEmbedding, chunk.embedding) * 0.7;
                }

                // BM25 keyword score (weight: 0.3, or 1.0 if no embeddings)
                const keywordScore = bm25Score(query, chunk.text);
                score += keywordScore * (queryEmbedding ? 0.3 : 1.0);

                // Recency boost — newer memories get a small boost
                const ageHours = (Date.now() - chunk.timestamp) / (1000 * 60 * 60);
                const recencyBoost = Math.max(0, 0.1 * (1 - ageHours / (24 * 30)));
                score += recencyBoost;

                // Summaries get a slight boost since they're more information-dense
                if (chunk.type === 'summary') {
                    score *= 1.15;
                }

                // Stage-based boost — higher stage = more reliable
                const stageBoost: Record<string, number> = {
                    observation: 1.0, episode: 1.05, fact: 1.15, belief: 1.25, trait: 1.35,
                };
                score *= stageBoost[chunk.stage] || 1.0;

                // Importance boost
                score *= (0.8 + chunk.importance * 0.4);

                return { ...chunk, score };
            })
            .filter(c => c.score > 0.05);

        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, limit);

        // Record access for recall intelligence
        const now = Date.now();
        for (const result of results) {
            const original = this.chunks.find(c => c.id === result.id);
            if (original) {
                original.accessCount++;
                original.lastAccessed = now;
                original.lastAccessContext = {
                    intent: query.slice(0, 200),
                    domains: [],
                    weights: {},
                };
            }
        }
        if (results.length > 0) this.scheduleSave();

        return results;
    }

    /** Get all chunks for a session */
    getSession(sessionId: string): MemoryChunk[] {
        return this.chunks.filter(c => c.sessionId === sessionId);
    }

    /** Get the N most recent chunks */
    getRecent(limit = 10): MemoryChunk[] {
        return this.chunks
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /** Get all unique session IDs */
    getSessions(): string[] {
        return [...new Set(this.chunks.map(c => c.sessionId))];
    }

    /** Get unconsolidated chunks (for consolidator skill synthesis) */
    getUnconsolidated(): MemoryChunk[] {
        return this.chunks.filter(c => !c.consolidated);
    }

    /** Total chunk count */
    get size(): number {
        return this.chunks.length;
    }

    /** Remove all chunks */
    async clear(): Promise<void> {
        this.chunks = [];
        await this.flush();
    }

    /** Flush to disk */
    async flush(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const { dirname } = await import('path');
            await fs.mkdir(dirname(this.filePath), { recursive: true });
            await fs.writeFile(this.filePath, JSON.stringify(this.chunks), 'utf-8');
        } catch (err) {
            console.error('Failed to persist vector store:', err);
        }
    }

    private scheduleSave(): void {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(async () => {
            this.saveTimer = null;
            await this.flush();
        }, 1000);
    }
}
