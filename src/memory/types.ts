/**
 * Memory types — all type definitions for the memory system.
 * @module memory/types
 */

// ── Entity types ───────────────────────────────────────

export type EntityType =
    | 'person' | 'project' | 'technology' | 'preference'
    | 'concept' | 'file' | 'service' | 'organization'
    | 'agent-self' | 'other';

export const RELATION_TYPES = [
    'uses', 'owns', 'works-on', 'prefers', 'knows',
    'depends-on', 'created', 'related-to', 'part-of',
    'manages', 'dislikes', 'learned', 'improved',
] as const;
export type RelationType = typeof RELATION_TYPES[number];

export interface Entity {
    name: string;
    type: EntityType;
    facts: string[];
    lastSeen: number;
    accessCount: number;
}

export interface Relation {
    from: string;
    to: string;
    type: RelationType;
    createdAt: number;
}

// ── Exchange (conversation memory) ─────────────────────

export interface Exchange {
    id: string;
    user: string;
    assistant: string;
    timestamp: number;
    sessionId: string;
}

// ── Active tasks (working state / executive memory) ────

export type TaskStatus = 'running' | 'paused' | 'completed' | 'aborted';

export interface ActiveTask {
    id: string;
    title: string;
    goal: string;
    status: TaskStatus;
    startedAt: number;
    lastStepAt: number;
    budgetRemaining?: number;
    successCondition?: string;
    stopReason?: string;
}

/** Max duration (ms) before a running task is auto-expired. Default 2 hours. */
export const TASK_MAX_DURATION_MS = 2 * 60 * 60 * 1000;

// ── Persisted data shape ───────────────────────────────

export interface MemoryData {
    version: 4;
    entities: Entity[];
    relations: Relation[];
    exchanges: Exchange[];
    activeTasks: ActiveTask[];
}

// ── Config ─────────────────────────────────────────────

export interface MemoryConfig {
    storagePath: string;
    ownerName?: string;
    recentWindowSize?: number;
    contextBudget?: number;
    entityExtractor?: (prompt: string) => Promise<string>;
}

// ── Context result (consumed by prompt-builder) ────────

export interface ContextResult {
    recentHistory: string;
    relevantMemories: string;
    graphContext: string;
    skillContext: string;
    stats: {
        recentCount: number;
        retrievedCount: number;
        graphEntities: number;
        totalChunks: number;
        skillCount: number;
        situation: { primary: string[]; goal: string };
    };
}

// ── Search result ──────────────────────────────────────

export interface SearchResult {
    content: string;
    source: 'graph' | 'exchange';
    relevance: number;
}

export const SELF_ENTITY_NAME = 'Forkscout Agent';
