/**
 * Knowledge Graph — barrel re-exports.
 *
 * Provides a single entry point for all knowledge-graph sub-modules.
 * Consumers import from `'./knowledge-graph'` (resolves to this index).
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

// Graph class
export { KnowledgeGraph } from './graph';

// Extraction prompt
export { buildExtractionPrompt } from './extraction';
