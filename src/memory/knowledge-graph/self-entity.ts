/**
 * Self-entity management — bootstrap and maintain the agent's identity node.
 *
 * The "self entity" is a special node (`SELF_ENTITY_NAME`) of type
 * `'agent-self'` that stores the agent's core observations about itself.
 * It is auto-created on first access and upgraded if it was previously
 * stored as a different type.
 *
 * @module knowledge-graph/self-entity
 */

import type { Entity } from './types';
import { SELF_ENTITY_NAME } from './types';
import type { GraphState } from './state';
import { normalizeKey } from './state';
import { addEntity, addObservations } from './entities';
import { addRelation } from './relation-ops';

/** The five seed observations every agent-self entity starts with. */
function seedObservations(ownerName: string): string[] {
    return [
        'Autonomous AI agent with own identity, memory, and judgment',
        `Created by ${ownerName} — works WITH them as a partner, not FOR them as a servant`,
        'Uses cognitive memory: knowledge graph + vector store + skills',
        'Makes own decisions — can refuse, negotiate, or suggest alternatives',
        'Can self-edit source code and evolve over time',
    ];
}

/**
 * Get the agent's self-identity entity.
 *
 * - Creates a seed entity with core observations if it doesn't exist yet.
 * - Upgrades the entity type to `'agent-self'` if it was stored as something else.
 * - Establishes the `serves` relation to the owner.
 *
 * @param state - The graph state
 * @returns The self-identity entity (never `undefined`)
 *
 * @example
 * ```ts
 * const self = getSelfEntity(state);
 * console.log(self.observations.length); // at least 5
 * ```
 */
export function getSelfEntity(state: GraphState): Entity {
    let self = state.entities.get(normalizeKey(SELF_ENTITY_NAME));

    if (!self) {
        self = addEntity(state, SELF_ENTITY_NAME, 'agent-self', seedObservations(state.ownerName), 'system');
        // Establish core relation
        if (!state.entities.get(normalizeKey(state.ownerName))) {
            addEntity(state, state.ownerName, 'person', ['Creator and primary collaborator'], 'system');
        }
        addRelation(state, SELF_ENTITY_NAME, state.ownerName, 'serves', undefined, 'system');
        console.log(`🤖 Self-identity entity seeded: ${SELF_ENTITY_NAME}`);
    } else if (self.type !== 'agent-self') {
        self.type = 'agent-self';
        addObservations(state, SELF_ENTITY_NAME, seedObservations(state.ownerName), 'system');
        const hasServesRelation = state.relations.some(
            r => r.from.toLowerCase() === SELF_ENTITY_NAME.toLowerCase() && r.type === 'serves',
        );
        if (!hasServesRelation) {
            addRelation(state, SELF_ENTITY_NAME, state.ownerName, 'serves', undefined, 'system');
        }
        state.dirty = true;
        console.log(`🤖 Self-identity entity upgraded: ${SELF_ENTITY_NAME} (project → agent-self)`);
    }

    return self;
}

/**
 * Add an observation to the self-entity (auto-creates if missing).
 *
 * @param state   - The graph state
 * @param content - The observation text
 * @param source  - Evidence source label (default `'self-reflect'`)
 */
export function addSelfObservation(state: GraphState, content: string, source: string = 'self-reflect'): void {
    getSelfEntity(state); // ensure exists
    addObservations(state, SELF_ENTITY_NAME, [content], source);
}
