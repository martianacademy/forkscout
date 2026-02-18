/**
 * Consolidation types — configuration and result interfaces.
 *
 * @module memory/consolidator/types
 */

export interface ConsolidationConfig {
    /** Min confirmations for observation → episode */
    observationToEpisode?: number;
    /** Min confirmations for episode → fact */
    episodeToFact?: number;
    /** Min age (ms) for episode → fact */
    episodeToFactAge?: number;
    /** Min confirmations for fact → belief */
    factToBelief?: number;
    /** Min age (ms) for fact → belief */
    factToBeliefAge?: number;
    /** Min confidence for fact → belief */
    factToBeliefConfidence?: number;
    /** Min confirmations for belief → trait */
    beliefToTrait?: number;
    /** Min age (ms) for belief → trait */
    beliefToTraitAge?: number;
    /** Min confidence for belief → trait */
    beliefToTraitConfidence?: number;
    /** Confidence threshold below which observations are pruned */
    pruneThreshold?: number;
    /** Min mutations between consolidation runs */
    mutationThreshold?: number;
}

export const DEFAULT_CONFIG: Required<ConsolidationConfig> = {
    observationToEpisode: 2,
    episodeToFact: 4,
    episodeToFactAge: 24 * 60 * 60 * 1000, // 1 day
    factToBelief: 6,
    factToBeliefAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    factToBeliefConfidence: 0.7,
    beliefToTrait: 10,
    beliefToTraitAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    beliefToTraitConfidence: 0.85,
    pruneThreshold: 0.25,
    mutationThreshold: 20,
};

export interface ConsolidationResult {
    promoted: number;
    pruned: number;
    merged: number;
    skillsSynthesized: number;
    duration: number;
}
