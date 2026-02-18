/**
 * Knowledge Graph — barrel re-exports.
 *
 * Provides a single entry point for all knowledge-graph sub-modules.
 * Consumers import from `'./knowledge-graph'` (resolves to this index).
 *
 * After the class → functional conversion, the KnowledgeGraph class is gone.
 * Consumers use `createGraphState()` + standalone functions that take `GraphState`.
 *
 * @module knowledge-graph
 */

// Types, interfaces, and constants
export type {
    MemoryStage,
    Evidence,
    Observation,
    RelationType,
    Entity,
    EntityType,
    Relation,
    GraphData,
    GraphSearchResult,
    ExtractedEntities,
} from './types';
export {
    STAGE_WEIGHTS,
    RELATION_TYPES,
    SELF_ENTITY_NAME,
    SCHEMA_VERSION,
} from './types';

// Evidence helpers
export { freshEvidence, computeConfidence, computeWeight } from './evidence';

// Relation normalisation
export { normalizeRelationType } from './relations';

// State (replaces KnowledgeGraph constructor)
export { type GraphState, createGraphState, normalizeKey, trackMutation, scheduleSave } from './state';

// Lifecycle (replaces init/flush/clear methods)
export { initGraph, flushGraph, clearGraph } from './lifecycle';

// Entity CRUD
export { addEntity, getEntity, addObservations, updateSessionContext, deleteEntity } from './entities';

// Self-identity entity
export { getSelfEntity, addSelfObservation } from './self-entity';

// Relation operations
export { addRelation, deleteRelation } from './relation-ops';

// Search & traversal
export { searchGraph, getNeighbors, traverseGraph } from './search';

// LLM extraction merge
export { mergeExtracted } from './merge';

// Formatting (pure function, no state needed)
export { formatForContext } from './format';

// Consolidation helpers
export {
    getAllEntities, getAllRelations, getMeta,
    entityCount, relationCount,
    setEntity, setRelations,
    markConsolidated, needsConsolidation,
} from './consolidation';

// Extraction prompt
export { buildExtractionPrompt } from './extraction';
