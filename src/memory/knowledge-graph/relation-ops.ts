/**
 * Relation operations — add and delete typed edges between entities.
 *
 * Relations use a canonical ontology (see `RELATION_TYPES` in `./types`).
 * Free-form type strings are normalised before storage. Duplicate relations
 * get their evidence reinforced rather than being duplicated.
 *
 * @module knowledge-graph/relation-ops
 */

import type { MemoryStage, Relation } from './types';
import { computeWeight, freshEvidence } from './evidence';
import { normalizeRelationType } from './relations';
import type { GraphState } from './state';
import { normalizeKey, trackMutation } from './state';

/**
 * Add a relation between two entities.
 *
 * Type is normalised to the canonical ontology. If an identical relation
 * already exists (same from/to/type), its evidence is reinforced instead
 * of creating a duplicate. New relations always start at `stage = 'observation'`.
 *
 * @param state   - The graph state
 * @param from    - Source entity name
 * @param to      - Target entity name
 * @param type    - Free-form relation type (normalised internally)
 * @param context - Optional context string
 * @param source  - Evidence source label
 * @returns The relation (new or existing)
 *
 * @example
 * ```ts
 * const rel = addRelation(state, 'Alice', 'TypeScript', 'uses', 'for the dashboard', 'explicit');
 * ```
 */
export function addRelation(
    state: GraphState,
    from: string,
    to: string,
    type: string,
    context?: string,
    source: string = 'extracted',
): Relation {
    const normalizedType = normalizeRelationType(type);
    const fromKey = normalizeKey(from);
    const toKey = normalizeKey(to);

    const existing = state.relations.find(
        r => normalizeKey(r.from) === fromKey &&
            normalizeKey(r.to) === toKey &&
            r.type === normalizedType,
    );

    if (existing) {
        existing.evidence.confirmations++;
        existing.evidence.lastConfirmedAt = Date.now();
        if (source && !existing.evidence.sources.includes(source)) {
            existing.evidence.sources.push(source);
        }
        existing.weight = computeWeight(existing.evidence, existing.stage);
        if (context) existing.context = context;
        trackMutation(state);
        return existing;
    }

    const evidence = freshEvidence(source);
    const stage: MemoryStage = 'observation';
    const relation: Relation = {
        from,
        to,
        type: normalizedType,
        stage,
        evidence,
        weight: computeWeight(evidence, stage),
        source,
        context,
        createdAt: Date.now(),
    };
    state.relations.push(relation);
    trackMutation(state);
    return relation;
}

/**
 * Delete a specific relation by its from/to/type triple.
 *
 * @param state - The graph state
 * @param from  - Source entity name
 * @param to    - Target entity name
 * @param type  - Relation type (normalised internally)
 * @returns `true` if a relation was found and removed
 */
export function deleteRelation(state: GraphState, from: string, to: string, type: string): boolean {
    const normalizedType = normalizeRelationType(type);
    const before = state.relations.length;
    state.relations = state.relations.filter(
        r => !(normalizeKey(r.from) === normalizeKey(from) &&
            normalizeKey(r.to) === normalizeKey(to) &&
            r.type === normalizedType),
    );
    if (state.relations.length !== before) {
        trackMutation(state);
        return true;
    }
    return false;
}
