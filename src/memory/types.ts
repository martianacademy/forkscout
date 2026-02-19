/**
 * Memory types — all type definitions for the memory system.
 * @module memory/types
 */

// ── Entity types ───────────────────────────────────────

export type EntityType =
    | 'person'
    | 'project'
    | 'technology'
    | 'preference'
    | 'concept'
    | 'file'
    | 'service'
    | 'organization'
    | 'agent-self'

    // NEW — cognition
    | 'goal'          // desired outcome
    | 'task'          // active work unit
    | 'plan'          // multi-step strategy
    | 'skill'         // learned capability
    | 'problem'       // detected issue
    | 'hypothesis'    // belief to test
    | 'decision'      // chosen path
    | 'constraint'    // rule or limitation

    // NEW — experience
    | 'event'         // something that happened
    | 'episode'       // grouped events
    | 'outcome'       // result of action
    | 'failure'       // negative outcome
    | 'success'       // positive outcome

    // NEW — environment
    | 'resource'      // CPU, disk, API quota, time
    | 'state'         // runtime condition
    | 'signal'        // trigger or observation

    | 'other';

export const RELATION_TYPES = [
    // existing
    'uses', 'owns', 'works-on', 'prefers', 'knows',
    'depends-on', 'created', 'related-to', 'part-of',
    'manages', 'dislikes', 'learned', 'improved',

    // NEW — intentional
    'pursues',        // agent → goal
    'plans',          // goal → plan
    'executes',       // agent → task
    'blocks',         // constraint → task
    'requires',       // task → resource
    'prioritizes',    // goal → goal

    // NEW — temporal / causal
    'causes',
    'results-in',
    'leads-to',
    'precedes',
    'follows',

    // NEW — learning
    'observed',
    'predicted',
    'confirmed',
    'contradicted',
    'generalizes',
    'derived-from',

    // NEW — performance
    'succeeded-at',
    'failed-at',
    'improved-by',
    'degraded-by',

    // NEW — memory
    'remembers',
    'forgets',
    'updates',
    'replaces',
] as const;
export type RelationType = typeof RELATION_TYPES[number];

// ── Structured facts ───────────────────────────────────

export interface Fact {
    content: string;
    confidence: number;       // 0-1, auto-calculated from sources + recency
    sources: number;          // how many times confirmed
    firstSeen: number;        // timestamp
    lastConfirmed: number;    // timestamp
}

export interface Entity {
    name: string;
    type: EntityType;
    facts: Fact[];             // v5: structured facts with confidence
    lastSeen: number;
    accessCount: number;
}

export interface Relation {
    from: string;
    to: string;
    type: RelationType;
    weight: number;           // 0-1, reinforced by repeated evidence
    evidenceCount: number;    // how many times this relation was asserted
    lastValidated: number;    // timestamp
    createdAt: number;
}

// ── Exchange (conversation memory) ─────────────────────

export interface Exchange {
    id: string;
    user: string;
    assistant: string;
    timestamp: number;
    sessionId: string;
    importance?: number;      // 0-1, higher = more likely to surface in search
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
    priority?: number;        // 0-1, higher = more urgent
    importance?: number;      // 0-1, higher = more significant to remember
}

/** Max duration (ms) before a running task is auto-expired. Default 2 hours. */
export const TASK_MAX_DURATION_MS = 2 * 60 * 60 * 1000;

// ── Persisted data shape ───────────────────────────────

export interface MemoryData {
    version: 5;
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
    /** URL to the Forkscout Memory MCP server (required). */
    mcpUrl?: string;
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

export const SELF_ENTITY_NAME = process.env.SELF_ENTITY_NAME || 'Forkscout Agent';
