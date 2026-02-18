/**
 * Entity CRUD — add, get, update observations, session context, and delete.
 *
 * All write operations enforce the golden rule: new observations always
 * start at `stage = 'observation'`. Duplicate observations get their
 * evidence reinforced instead of being duplicated.
 *
 * @module knowledge-graph/entities
 */

import type { Entity, EntityType, MemoryStage } from './types';
import { freshEvidence } from './evidence';
import type { GraphState } from './state';
import { normalizeKey, trackMutation } from './state';

/**
 * Add or merge an entity. If the entity already exists, new observations
 * are merged and duplicates get their evidence reinforced.
 *
 * @param state              - The graph state
 * @param name               - Display name of the entity
 * @param type               - Semantic type (person, technology, project, …)
 * @param observationStrings - Facts about this entity
 * @param source             - Evidence source: `'explicit'` | `'extracted'` | `'consolidator'`
 * @returns The created or updated entity
 *
 * @example
 * ```ts
 * const entity = addEntity(state, 'TypeScript', 'technology', ['Preferred language'], 'explicit');
 * ```
 */
export function addEntity(
    state: GraphState,
    name: string,
    type: EntityType,
    observationStrings: string[],
    source: string = 'extracted',
): Entity {
    const key = normalizeKey(name);
    const existing = state.entities.get(key);
    const now = Date.now();

    if (existing) {
        for (const obsStr of observationStrings) {
            const match = existing.observations.find(o => o.content === obsStr);
            if (match) {
                match.evidence.confirmations++;
                match.evidence.lastConfirmedAt = now;
                if (!match.evidence.sources.includes(source)) {
                    match.evidence.sources.push(source);
                }
            } else {
                existing.observations.push({
                    content: obsStr,
                    stage: 'observation',
                    evidence: freshEvidence(source),
                    source,
                    createdAt: now,
                });
            }
        }
        existing.updatedAt = now;
        if (existing.type === 'other' && type !== 'other') {
            existing.type = type;
        }
        trackMutation(state);
        return existing;
    }

    const entity: Entity = {
        name,
        type,
        observations: observationStrings.map(content => ({
            content,
            stage: 'observation' as MemoryStage,
            evidence: freshEvidence(source),
            source,
            createdAt: now,
        })),
        accessCount: 0,
        createdAt: now,
        updatedAt: now,
    };
    state.entities.set(key, entity);
    trackMutation(state);
    return entity;
}

/**
 * Get an entity by exact name (case-insensitive).
 *
 * @param state - The graph state
 * @param name  - Entity name to look up
 * @returns The entity, or `undefined` if not found
 */
export function getEntity(state: GraphState, name: string): Entity | undefined {
    return state.entities.get(normalizeKey(name));
}

/**
 * Add string observations to an existing entity (always `stage = 'observation'`).
 * Duplicate observations get their evidence reinforced.
 *
 * @param state        - The graph state
 * @param name         - Entity name
 * @param observations - Array of fact strings to add
 * @param source       - Evidence source label
 * @returns `true` if the entity was found and updated
 */
export function addObservations(
    state: GraphState,
    name: string,
    observations: string[],
    source: string = 'extracted',
): boolean {
    const entity = state.entities.get(normalizeKey(name));
    if (!entity) return false;

    const now = Date.now();
    for (const obsStr of observations) {
        const match = entity.observations.find(o => o.content === obsStr);
        if (match) {
            match.evidence.confirmations++;
            match.evidence.lastConfirmedAt = now;
        } else {
            entity.observations.push({
                content: obsStr,
                stage: 'observation',
                evidence: freshEvidence(source),
                source,
                createdAt: now,
            });
        }
    }
    entity.updatedAt = now;
    trackMutation(state);
    return true;
}

/**
 * Update a rolling session observation on an entity.
 *
 * Replaces any existing observation starting with `[Current Session]` —
 * only one per entity. Keeps each person's entity up-to-date with what
 * was just discussed, surviving restarts through the graph.
 *
 * @param state       - The graph state
 * @param name        - Entity name
 * @param sessionText - The session summary text
 * @returns `true` (entity is auto-created if missing)
 */
export function updateSessionContext(state: GraphState, name: string, sessionText: string): boolean {
    const key = normalizeKey(name);
    let entity = state.entities.get(key);
    if (!entity) {
        entity = addEntity(state, name, 'person', [], 'session');
    }

    const now = Date.now();
    const content = `[Current Session] ${sessionText}`;

    entity.observations = entity.observations.filter(o => !o.content.startsWith('[Current Session]'));
    entity.observations.push({
        content,
        stage: 'observation',
        evidence: freshEvidence('session'),
        source: 'session',
        createdAt: now,
    });

    entity.updatedAt = now;
    trackMutation(state);
    return true;
}

/**
 * Delete an entity and all its relations.
 *
 * @param state - The graph state
 * @param name  - Entity name to delete
 * @returns `true` if the entity existed and was removed
 */
export function deleteEntity(state: GraphState, name: string): boolean {
    const key = normalizeKey(name);
    if (!state.entities.has(key)) return false;

    state.entities.delete(key);
    state.relations = state.relations.filter(
        r => normalizeKey(r.from) !== key && normalizeKey(r.to) !== key,
    );
    trackMutation(state);
    return true;
}
