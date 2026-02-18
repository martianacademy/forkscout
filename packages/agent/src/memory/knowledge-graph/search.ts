/**
 * Graph search — entity lookup, neighbour traversal, and multi-hop search.
 *
 * Pure read operations on the graph state. Search records access counts
 * on matched entities for future relevance ranking.
 *
 * @module knowledge-graph/search
 */

import type { Entity, GraphSearchResult, Relation } from './types';
import { STAGE_WEIGHTS } from './types';
import type { GraphState } from './state';
import { normalizeKey } from './state';

/**
 * Search entities by name, type, or observation content.
 *
 * Weights results by observation stage. Records access count and context
 * on each matched entity.
 *
 * @param state - The graph state
 * @param query - Free-text search query
 * @param limit - Maximum results to return (default 5)
 * @returns Scored search results with neighbour context
 *
 * @example
 * ```ts
 * const results = searchGraph(state, 'TypeScript', 5);
 * ```
 */
export function searchGraph(state: GraphState, query: string, limit = 5): GraphSearchResult[] {
    const q = query.toLowerCase();
    const terms = q.split(/\s+/).filter(t => t.length > 2);
    const scored: GraphSearchResult[] = [];

    for (const entity of state.entities.values()) {
        let score = 0;
        const nameLower = entity.name.toLowerCase();

        if (nameLower === q) {
            score += 1.0;
        } else if (nameLower.includes(q) || q.includes(nameLower)) {
            score += 0.7;
        }

        for (const term of terms) {
            if (nameLower.includes(term)) score += 0.3;
        }

        for (const obs of entity.observations) {
            const obsLower = obs.content.toLowerCase();
            for (const term of terms) {
                if (obsLower.includes(term)) {
                    score += 0.15 * STAGE_WEIGHTS[obs.stage];
                }
            }
        }

        if (terms.some(t => entity.type.includes(t))) {
            score += 0.1;
        }

        if (score > 0.05) {
            entity.accessCount = (entity.accessCount || 0) + 1;
            entity.lastAccessContext = { intent: query, domains: [], weights: {} };

            const neighbors = getNeighbors(state, entity.name);
            scored.push({ entity, neighbors, score: Math.min(score, 1.0) });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

/**
 * Get all directly connected entities for a given entity.
 * Filters expired relations (`validUntil`) and sorts by weight.
 *
 * @param state - The graph state
 * @param name  - Entity name to find neighbours of
 * @returns Array of neighbour records with direction info
 */
export function getNeighbors(
    state: GraphState,
    name: string,
): Array<{ entity: Entity; relation: Relation; direction: 'outgoing' | 'incoming' }> {
    const key = normalizeKey(name);
    const now = Date.now();
    const neighbors: Array<{ entity: Entity; relation: Relation; direction: 'outgoing' | 'incoming' }> = [];

    for (const rel of state.relations) {
        if (rel.validUntil && rel.validUntil < now) continue;

        if (normalizeKey(rel.from) === key) {
            const target = state.entities.get(normalizeKey(rel.to));
            if (target) {
                neighbors.push({ entity: target, relation: rel, direction: 'outgoing' });
            }
        }
        if (normalizeKey(rel.to) === key) {
            const source = state.entities.get(normalizeKey(rel.from));
            if (source) {
                neighbors.push({ entity: source, relation: rel, direction: 'incoming' });
            }
        }
    }

    neighbors.sort((a, b) => (b.relation.weight || 0) - (a.relation.weight || 0));
    return neighbors;
}

/**
 * Multi-hop traversal from a starting entity.
 *
 * Follows relations outward up to `depth` hops, collecting every
 * reachable entity with its distance from the start.
 *
 * @param state     - The graph state
 * @param startName - Entity name to start from
 * @param depth     - Number of hops to traverse (default 2)
 * @returns Map of normalised entity key → `{ entity, distance }`
 */
export function traverseGraph(
    state: GraphState,
    startName: string,
    depth = 2,
): Map<string, { entity: Entity; distance: number }> {
    const visited = new Map<string, { entity: Entity; distance: number }>();
    const startKey = normalizeKey(startName);
    const startEntity = state.entities.get(startKey);
    if (!startEntity) return visited;

    visited.set(startKey, { entity: startEntity, distance: 0 });
    let frontier = [startKey];

    for (let d = 1; d <= depth; d++) {
        const nextFrontier: string[] = [];
        for (const key of frontier) {
            const entity = state.entities.get(key);
            if (!entity) continue;
            const nbrs = getNeighbors(state, entity.name);
            for (const { entity: neighbor } of nbrs) {
                const nKey = normalizeKey(neighbor.name);
                if (!visited.has(nKey)) {
                    visited.set(nKey, { entity: neighbor, distance: d });
                    nextFrontier.push(nKey);
                }
            }
        }
        frontier = nextFrontier;
    }

    return visited;
}
