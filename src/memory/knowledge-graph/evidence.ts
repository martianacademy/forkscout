/**
 * Evidence helper functions — create, score, and weight evidence records.
 *
 * These pure functions are used by the KnowledgeGraph (when adding/merging
 * observations) and by the Consolidator (when deciding stage promotions).
 *
 * @module knowledge-graph/evidence
 */

import type { Evidence, MemoryStage } from './types';
import { STAGE_WEIGHTS } from './types';

/**
 * Create a fresh evidence record for a new observation.
 *
 * Starts with 1 confirmation, 0 contradictions.
 *
 * @param source - Where the evidence came from, e.g. `'extracted'`, `'explicit'`, `'migrated'`
 * @returns A new `Evidence` object ready to be attached to an observation or relation
 *
 * @example
 * ```ts
 * const obs: Observation = {
 *     content: 'User prefers dark mode',
 *     evidence: freshEvidence('extracted'),
 *     // ...
 * };
 * ```
 */
export function freshEvidence(source: string = 'extracted'): Evidence {
    return {
        confirmations: 1,
        contradictions: 0,
        sources: [source],
        lastConfirmedAt: Date.now(),
    };
}

/**
 * Compute confidence from an evidence record.
 *
 * Formula: `confirmations / (confirmations + contradictions × 2)`
 *
 * Contradictions are double-weighted to be conservative — a single
 * contradiction needs two confirmations to overcome.
 *
 * @param evidence - The evidence record to score
 * @returns Confidence value between 0 and 1 (0.5 when no data)
 *
 * @example
 * ```ts
 * const conf = computeConfidence({ confirmations: 3, contradictions: 1, ... });
 * // → 3 / (3 + 2) = 0.6
 * ```
 */
export function computeConfidence(evidence: Evidence): number {
    const total = evidence.confirmations + evidence.contradictions * 2;
    if (total === 0) return 0.5;
    return evidence.confirmations / total;
}

/**
 * Compute weight = confidence × stage weight.
 *
 * Used by the search ranker to order results — higher-stage,
 * higher-confidence observations surface first.
 *
 * @param evidence - The evidence record
 * @param stage - The observation's current memory stage
 * @returns Weight value between 0 and 1
 *
 * @example
 * ```ts
 * const w = computeWeight(obs.evidence, obs.stage);
 * // A "fact" with 3 confirmations weighs more than an "observation" with 1
 * ```
 */
export function computeWeight(evidence: Evidence, stage: MemoryStage): number {
    return computeConfidence(evidence) * STAGE_WEIGHTS[stage];
}
