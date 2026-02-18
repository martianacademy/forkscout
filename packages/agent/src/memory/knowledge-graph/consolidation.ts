/**
 * Consolidation helpers — read/write accessors used by the Consolidator.
 *
 * The consolidator needs direct access to all entities, all relations,
 * and the metadata counters. These functions expose that without leaking
 * the full `GraphState` to the consolidation module.
 *
 * @module knowledge-graph/consolidation
 */

import type { Entity, GraphData, Relation } from './types';
import type { GraphState } from './state';
import { normalizeKey, scheduleSave } from './state';

/**
 * Get all entities (snapshot array — mutations still hit the originals).
 *
 * @param state - The graph state
 * @returns Array of all entity objects
 */
export function getAllEntities(state: GraphState): Entity[] {
    return Array.from(state.entities.values());
}

/**
 * Get all relations (shallow copy).
 *
 * @param state - The graph state
 * @returns Copy of the relations array
 */
export function getAllRelations(state: GraphState): Relation[] {
    return [...state.relations];
}

/**
 * Get the consolidation metadata (copy).
 *
 * @param state - The graph state
 * @returns A copy of the meta object
 */
export function getMeta(state: GraphState): GraphData['meta'] {
    return { ...state.meta };
}

/**
 * Number of entities currently in the graph.
 *
 * @param state - The graph state
 */
export function entityCount(state: GraphState): number {
    return state.entities.size;
}

/**
 * Number of relations currently in the graph.
 *
 * @param state - The graph state
 */
export function relationCount(state: GraphState): number {
    return state.relations.length;
}

/**
 * Set an entity directly — used by the consolidator for stage promotion.
 *
 * @param state  - The graph state
 * @param entity - The entity to set (keyed by normalised name)
 */
export function setEntity(state: GraphState, entity: Entity): void {
    state.entities.set(normalizeKey(entity.name), entity);
    scheduleSave(state);
}

/**
 * Replace all relations — used by the consolidator after dedup/normalisation.
 *
 * @param state     - The graph state
 * @param relations - The new relations array
 */
export function setRelations(state: GraphState, relations: Relation[]): void {
    state.relations = relations;
    scheduleSave(state);
}

/**
 * Mark consolidation as completed — resets mutation counter and bumps count.
 *
 * @param state - The graph state
 */
export function markConsolidated(state: GraphState): void {
    state.meta.lastConsolidatedAt = Date.now();
    state.meta.mutationsSinceConsolidation = 0;
    state.meta.consolidationCount++;
    scheduleSave(state);
}

/**
 * Check if consolidation should trigger based on a mutation threshold.
 *
 * @param state     - The graph state
 * @param threshold - Number of mutations required (default 100)
 * @returns `true` if mutations ≥ threshold
 */
export function needsConsolidation(state: GraphState, threshold = 100): boolean {
    return state.meta.mutationsSinceConsolidation >= threshold;
}
