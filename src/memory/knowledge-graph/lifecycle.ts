/**
 * Graph lifecycle — init, flush, clear, and v1→v2 migration.
 *
 * Handles loading the graph from disk, persisting changes, wiping data,
 * and migrating legacy v1 format (plain-string observations, free-form
 * relation types) to the current v2 schema.
 *
 * @module knowledge-graph/lifecycle
 */

import type { Entity, GraphData, MemoryStage, Relation } from './types';
import { SCHEMA_VERSION } from './types';
import { computeWeight, freshEvidence } from './evidence';
import { normalizeRelationType } from './relations';
import type { GraphState } from './state';
import { normalizeKey } from './state';

/**
 * Load the graph from its JSON file, migrating v1→v2 if necessary.
 * If the file doesn't exist or is unreadable, starts with an empty graph.
 *
 * @param state - The graph state to populate
 *
 * @example
 * ```ts
 * const state = createGraphState('/data/graph.json', 'Alice');
 * await initGraph(state);
 * ```
 */
export async function initGraph(state: GraphState): Promise<void> {
    try {
        const fs = await import('fs/promises');
        const raw = await fs.readFile(state.filePath, 'utf-8');
        const data = JSON.parse(raw) as GraphData & { version?: number };

        if (!data.version || data.version < SCHEMA_VERSION) {
            migrateV1(state, data);
        } else {
            for (const e of data.entities) {
                state.entities.set(normalizeKey(e.name), e);
            }
            state.relations = data.relations;
            state.meta = data.meta || state.meta;
        }
    } catch {
        // No existing graph — start fresh
    }
    console.log(`🧠 Knowledge graph: ${state.entities.size} entities, ${state.relations.length} relations (v${SCHEMA_VERSION})`);
}

/**
 * Persist the graph to disk. No-op if the graph is clean (no unsaved changes).
 *
 * @param state - The graph state to flush
 */
export async function flushGraph(state: GraphState): Promise<void> {
    if (!state.dirty) return;
    try {
        const fs = await import('fs/promises');
        const { dirname } = await import('path');
        await fs.mkdir(dirname(state.filePath), { recursive: true });
        const data: GraphData & { version: number } = {
            version: SCHEMA_VERSION,
            entities: Array.from(state.entities.values()),
            relations: state.relations,
            meta: state.meta,
        };
        await fs.writeFile(state.filePath, JSON.stringify(data, null, 2), 'utf-8');
        state.dirty = false;
    } catch (err) {
        console.error('Failed to persist knowledge graph:', err);
    }
}

/**
 * Wipe all graph data and persist the empty state immediately.
 *
 * @param state - The graph state to clear
 */
export async function clearGraph(state: GraphState): Promise<void> {
    state.entities.clear();
    state.relations = [];
    state.meta = { lastConsolidatedAt: null, mutationsSinceConsolidation: 0, consolidationCount: 0 };
    state.dirty = true;
    await flushGraph(state);
}

/**
 * Migrate v1 data (plain-string observations, free-form relation types)
 * to the v2 schema with structured observations + evidence tracking.
 *
 * @param state - The graph state to populate with migrated data
 * @param data  - The raw v1 JSON data
 */
function migrateV1(state: GraphState, data: any): void {
    console.log('📦 Migrating knowledge graph v1 → v2...');
    const now = Date.now();

    for (const e of data.entities || []) {
        const migratedEntity: Entity = {
            name: e.name,
            type: e.type || 'other',
            observations: (e.observations || []).map((obs: any) => {
                if (typeof obs === 'string') {
                    return {
                        content: obs,
                        stage: 'observation' as MemoryStage,
                        evidence: freshEvidence('migrated'),
                        source: 'migrated',
                        createdAt: e.createdAt || now,
                    };
                }
                return obs;
            }),
            accessCount: e.accessCount || 0,
            lastAccessContext: e.lastAccessContext,
            createdAt: e.createdAt || now,
            updatedAt: e.updatedAt || now,
        };
        state.entities.set(normalizeKey(migratedEntity.name), migratedEntity);
    }

    for (const r of data.relations || []) {
        const migratedRelation: Relation = {
            from: r.from,
            to: r.to,
            type: normalizeRelationType(r.type || 'related_to'),
            stage: r.stage || 'observation',
            evidence: r.evidence || freshEvidence('migrated'),
            weight: r.weight || computeWeight(r.evidence || freshEvidence('migrated'), r.stage || 'observation'),
            source: r.source || 'migrated',
            context: r.context,
            validFrom: r.validFrom,
            validUntil: r.validUntil,
            createdAt: r.createdAt || now,
        };
        state.relations.push(migratedRelation);
    }

    state.meta = data.meta || state.meta;
    state.dirty = true;
    console.log(`📦 Migration complete: ${state.entities.size} entities, ${state.relations.length} relations`);
}
