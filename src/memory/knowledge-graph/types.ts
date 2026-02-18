/**
 * Knowledge Graph — type definitions, interfaces, and constants.
 *
 * Defines the core data model for the cognitive memory architecture:
 *
 * - **MemoryStage lifecycle**: observation → episode → fact → belief → trait
 * - **Evidence tracking**: confirmations, contradictions, sources, confidence
 * - **Observations**: atomic knowledge units with stage + evidence metadata
 * - **Entities**: named nodes (person, project, technology…) with observations
 * - **Relations**: typed edges between entities using a canonical ontology
 * - **Graph data**: the serialisable root container for the entire graph
 *
 * All types are pure data — no I/O, no side-effects.
 *
 * @module knowledge-graph/types
 */

import type { AccessContext } from '../situation';

// ── Memory Stage Lifecycle ────────────────────────────

/**
 * Stage lifecycle for observations:
 *   observation → episode → fact → belief → trait
 *
 * - observation: raw LLM captures (what was said)
 * - episode: contextual summary (what happened)
 * - fact: confirmed truth (verified multiple times)
 * - belief: stable opinion/pattern (held over time)
 * - trait: core identity trait (deeply ingrained)
 */
export type MemoryStage = 'observation' | 'episode' | 'fact' | 'belief' | 'trait';

/**
 * Weight multiplier per stage — higher stage = more authoritative.
 *
 * Used by the search ranker to prioritise promoted observations:
 * `score = confidence × STAGE_WEIGHTS[stage]`
 */
export const STAGE_WEIGHTS: Record<MemoryStage, number> = {
    observation: 0.3,
    episode: 0.4,
    fact: 0.7,
    belief: 0.9,
    trait: 1.0,
};

// ── Evidence Tracking ─────────────────────────────────

/**
 * Evidence record for an observation — tracks how well-supported it is.
 *
 * Attached to every `Observation` and `Relation`. The consolidator uses
 * evidence to decide when to promote an observation to the next stage.
 */
export interface Evidence {
    /** Number of times this has been confirmed */
    confirmations: number;
    /** Number of times this has been contradicted */
    contradictions: number;
    /** Where the evidence came from (e.g. 'explicit', 'extracted', 'consolidator') */
    sources: string[];
    /** When this was last confirmed */
    lastConfirmedAt: number;
}

// ── Observation ───────────────────────────────────────

/**
 * A single observation within an entity — the atomic unit of knowledge.
 *
 * Observations are the only thing the LLM can write to the graph.
 * Stage promotion is handled exclusively by the consolidator.
 */
export interface Observation {
    /** The content of the observation */
    content: string;
    /** Current stage in the lifecycle */
    stage: MemoryStage;
    /** Evidence supporting/contradicting this observation */
    evidence: Evidence;
    /** Where this observation came from */
    source: string;
    /** When this became valid (optional, for temporal reasoning) */
    validFrom?: number;
    /** When this stops being valid (optional, for temporal reasoning) */
    validUntil?: number;
    /** Decay rate per day (0 = never decays, 1 = fully decays in a day) */
    decayRate?: number;
    /** When this observation was first created */
    createdAt: number;
}

// ── Relation Types (Canonical Ontology) ───────────────

/**
 * The canonical relation types — all relations must use one of these.
 *
 * Free-form strings are normalised to the nearest canonical type via
 * `normalizeRelationType()`.
 */
export const RELATION_TYPES = [
    'uses', 'prefers', 'preferred_over', 'works_at', 'created',
    'depends_on', 'contains', 'instance_of', 'produces', 'related_to', 'serves',
] as const;

/** Union type of all allowed relation type strings */
export type RelationType = typeof RELATION_TYPES[number];

// ── Entity ────────────────────────────────────────────

/**
 * A node in the knowledge graph — a named thing with observations.
 *
 * Entities are created when the LLM extracts structured info from
 * conversations, and progressively enriched over time.
 */
export interface Entity {
    name: string;
    type: EntityType;
    /** Observations now carry stage, evidence, and source metadata */
    observations: Observation[];
    /** How many times this entity has been accessed in search results */
    accessCount: number;
    /** Last access context — what query + domains triggered access */
    lastAccessContext?: AccessContext;
    /** When this entity was first seen */
    createdAt: number;
    /** When this entity was last updated */
    updatedAt: number;
}

/**
 * Discriminated entity categories.
 *
 * Controls which domains an entity has natural affinity with
 * (see `ENTITY_DOMAIN_AFFINITY` in the situation module).
 */
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
    | 'other';

/** The canonical name for the agent's self-identity entity */
export const SELF_ENTITY_NAME = 'Forkscout';

// ── Relation ──────────────────────────────────────────

/**
 * A directed, typed edge between two entities.
 *
 * Relations follow the same stage lifecycle as observations and
 * carry independent evidence tracking.
 */
export interface Relation {
    from: string;
    to: string;
    /** Locked to canonical ontology */
    type: RelationType;
    /** Current stage in lifecycle */
    stage: MemoryStage;
    /** Evidence supporting this relation */
    evidence: Evidence;
    /** Computed weight = confidence × stage_weight */
    weight: number;
    /** Where this relation came from */
    source: string;
    /** Optional additional context */
    context?: string;
    /** Temporal validity */
    validFrom?: number;
    validUntil?: number;
    createdAt: number;
}

// ── Graph Container ───────────────────────────────────

/** Schema version for automatic migration */
export const SCHEMA_VERSION = 2;

/**
 * Root serialisable container for the entire knowledge graph.
 *
 * Persisted as a single JSON file alongside `vectors.json`.
 */
export interface GraphData {
    /** Schema version for automatic migration */
    version?: number;
    entities: Entity[];
    relations: Relation[];
    /** Consolidation metadata */
    meta: {
        lastConsolidatedAt: number | null;
        mutationsSinceConsolidation: number;
        consolidationCount: number;
    };
}

// ── Search Result ─────────────────────────────────────

/**
 * A single search hit from `KnowledgeGraph.search()`.
 *
 * Includes the matched entity, its direct neighbours, and a
 * relevance score (0–1) combining name/observation/type matches.
 */
export interface GraphSearchResult {
    entity: Entity;
    /** Directly connected entities */
    neighbors: Array<{ entity: Entity; relation: Relation; direction: 'outgoing' | 'incoming' }>;
    /** Relevance score (0–1) */
    score: number;
}

// ── Extraction Types ──────────────────────────────────

/**
 * LLM extraction output — entities and relations parsed from a conversation turn.
 *
 * Produced by `buildExtractionPrompt()` + LLM call, then fed into
 * `KnowledgeGraph.mergeExtracted()`.
 */
export interface ExtractedEntities {
    entities: Array<{
        name: string;
        type: EntityType;
        observations: string[];
    }>;
    relations: Array<{
        from: string;
        to: string;
        type: string;
    }>;
}
