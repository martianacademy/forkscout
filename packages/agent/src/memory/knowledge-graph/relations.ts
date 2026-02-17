/**
 * Relation type normaliser — maps free-form strings to the canonical ontology.
 *
 * The knowledge graph uses a locked set of relation types (see `RELATION_TYPES`
 * in `./types.ts`). This module maps common synonyms / variations to the
 * nearest canonical type, falling back to `'related_to'` for unknown inputs.
 *
 * @module knowledge-graph/relations
 */

import type { RelationType } from './types';

/**
 * Alias map: free-form relation string → canonical `RelationType`.
 *
 * Covers common synonyms for each canonical type. Unknown strings
 * fall through to `'related_to'`.
 */
const RELATION_ALIASES: Record<string, RelationType> = {
    // uses
    uses: 'uses', used_by: 'uses', utilizes: 'uses', employs: 'uses',
    works_with: 'uses', runs_on: 'uses', built_with: 'uses',
    // prefers
    prefers: 'prefers', likes: 'prefers', favors: 'prefers', chosen: 'prefers',
    // preferred_over
    preferred_over: 'preferred_over', better_than: 'preferred_over',
    // works_at
    works_at: 'works_at', employed_by: 'works_at', member_of: 'works_at',
    belongs_to: 'works_at',
    // created
    created: 'created', authored: 'created', built: 'created',
    wrote: 'created', developed: 'created', made: 'created',
    // depends_on
    depends_on: 'depends_on', requires: 'depends_on', needs: 'depends_on',
    relies_on: 'depends_on',
    // contains
    contains: 'contains', has: 'contains', includes: 'contains',
    part_of: 'contains',
    // instance_of
    instance_of: 'instance_of', is_a: 'instance_of', type_of: 'instance_of',
    // produces
    produces: 'produces', generates: 'produces', outputs: 'produces',
    emits: 'produces',
    // related_to (catch-all)
    related_to: 'related_to', associated_with: 'related_to',
    connected_to: 'related_to', linked_to: 'related_to',
    // serves
    serves: 'serves', assists: 'serves', helps: 'serves',
    supports: 'serves', works_for: 'serves',
};

/**
 * Normalise a free-form relation type string to a canonical `RelationType`.
 *
 * Lowercases, trims, and replaces spaces/dashes with underscores before
 * looking up the alias map. Returns `'related_to'` for unknown inputs.
 *
 * @param type - The raw relation string, e.g. `"Built With"`, `"employs"`, `"???"`
 * @returns The nearest canonical `RelationType`
 *
 * @example
 * ```ts
 * normalizeRelationType('Built With');   // → 'uses'
 * normalizeRelationType('employs');      // → 'uses'
 * normalizeRelationType('unknown_rel');  // → 'related_to'
 * ```
 */
export function normalizeRelationType(type: string): RelationType {
    const key = type.toLowerCase().trim().replace(/[\s-]+/g, '_');
    return RELATION_ALIASES[key] ?? 'related_to';
}
