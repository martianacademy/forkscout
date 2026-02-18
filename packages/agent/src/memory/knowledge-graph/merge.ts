/**
 * Merge extracted — bulk-import LLM-extracted entities and relations.
 *
 * Called by `MemoryManager` after each assistant turn to integrate
 * structured knowledge extracted from the conversation. All new data
 * starts at `stage = 'observation'` (golden rule).
 *
 * @module knowledge-graph/merge
 */

import type { ExtractedEntities } from './types';
import { computeWeight } from './evidence';
import { normalizeRelationType } from './relations';
import type { GraphState } from './state';
import { normalizeKey } from './state';
import { addEntity } from './entities';
import { addRelation } from './relation-ops';

/**
 * Merge extracted entities and relations into the graph.
 *
 * - New entities are created at `stage = 'observation'`.
 * - Existing entities get their observations reinforced.
 * - Missing relation endpoints are auto-created as type `'other'`.
 * - Duplicate relations get evidence reinforced.
 *
 * @param state     - The graph state
 * @param extracted - Structured entities + relations from the LLM
 * @returns Counts of newly created entities and relations
 *
 * @example
 * ```ts
 * const { newEntities, newRelations } = mergeExtracted(state, parsedJson);
 * console.log(`+${newEntities} entities, +${newRelations} relations`);
 * ```
 */
export function mergeExtracted(
    state: GraphState,
    extracted: ExtractedEntities,
): { newEntities: number; newRelations: number } {
    let newEntities = 0;
    let newRelations = 0;

    for (const e of extracted.entities) {
        const key = normalizeKey(e.name);
        if (!state.entities.has(key)) newEntities++;
        addEntity(state, e.name, e.type, e.observations, 'extracted');
    }

    for (const r of extracted.relations) {
        const fromKey = normalizeKey(r.from);
        const toKey = normalizeKey(r.to);
        if (!state.entities.has(fromKey)) {
            addEntity(state, r.from, 'other', [], 'extracted');
            newEntities++;
        }
        if (!state.entities.has(toKey)) {
            addEntity(state, r.to, 'other', [], 'extracted');
            newEntities++;
        }

        const normalizedType = normalizeRelationType(r.type);
        const existing = state.relations.find(
            rel => normalizeKey(rel.from) === fromKey &&
                normalizeKey(rel.to) === toKey &&
                rel.type === normalizedType,
        );
        if (!existing) {
            addRelation(state, r.from, r.to, r.type, undefined, 'extracted');
            newRelations++;
        } else {
            existing.evidence.confirmations++;
            existing.evidence.lastConfirmedAt = Date.now();
            existing.weight = computeWeight(existing.evidence, existing.stage);
        }
    }

    return { newEntities, newRelations };
}
