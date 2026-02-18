/**
 * Graph state — the shared mutable state bag for the knowledge graph.
 *
 * Instead of a class with private fields, all graph functions receive and
 * mutate a `GraphState` object. This enables a functional API where each
 * file exports standalone functions that operate on the same state.
 *
 * Create one via `createGraphState()` and pass it to every graph function.
 *
 * @module knowledge-graph/state
 */

import type { Entity, GraphData, Relation } from './types';

/**
 * Mutable state container for a knowledge graph instance.
 *
 * Holds the entity map, relations array, metadata, persistence path,
 * dirty flag, and the debounced save timer.
 */
export interface GraphState {
    /** Entity map keyed by normalised name (lowercase/trimmed) */
    entities: Map<string, Entity>;
    /** All relations in the graph */
    relations: Relation[];
    /** Consolidation / persistence metadata */
    meta: GraphData['meta'];
    /** Absolute path to the JSON persistence file */
    filePath: string;
    /** Owner name (used for self-entity bootstrapping) */
    ownerName: string;
    /** Whether the graph has unsaved changes */
    dirty: boolean;
    /** Reference to the debounced save timer (null if idle) */
    saveTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Create a fresh `GraphState` ready for use.
 *
 * @param filePath  - Absolute path to the JSON file on disk
 * @param ownerName - Owner/creator name for self-entity seeds (default `'Admin'`)
 * @returns A new, empty `GraphState`
 *
 * @example
 * ```ts
 * const state = createGraphState('/data/graph.json', 'Alice');
 * await initGraph(state);
 * addEntity(state, 'TypeScript', 'technology', ['Preferred language']);
 * ```
 */
export function createGraphState(filePath: string, ownerName: string = 'Admin'): GraphState {
    return {
        entities: new Map(),
        relations: [],
        meta: {
            lastConsolidatedAt: null,
            mutationsSinceConsolidation: 0,
            consolidationCount: 0,
        },
        filePath,
        ownerName,
        dirty: false,
        saveTimer: null,
    };
}

// ── Internal helpers (shared by all graph modules) ────

/**
 * Normalise an entity name to a map key.
 * Lowercase + trim — used everywhere for case-insensitive lookups.
 */
export function normalizeKey(name: string): string {
    return name.toLowerCase().trim();
}

/**
 * Track a mutation: increment the mutation counter and schedule auto-save.
 * Called after every write operation (add/update/delete).
 */
export function trackMutation(state: GraphState): void {
    state.meta.mutationsSinceConsolidation++;
    scheduleSave(state);
}

/**
 * Debounced auto-save: marks dirty and sets a 1 s timer.
 * If a timer is already running, this is a no-op (coalesces writes).
 */
export function scheduleSave(state: GraphState): void {
    state.dirty = true;
    if (state.saveTimer) return;
    state.saveTimer = setTimeout(async () => {
        state.saveTimer = null;
        // Dynamic import to avoid top-level fs dependency
        const { flushGraph } = await import('./lifecycle');
        await flushGraph(state);
    }, 1000);
}
