/**
 * Promotion logic — computes stage transitions for observations.
 *
 * Stage lifecycle: observation → episode → fact → belief → trait
 *
 * @module memory/consolidator/promotion
 */

import type { MemoryStage, Observation } from '../knowledge-graph';
import type { ConsolidationConfig } from './types';
import { DEFAULT_CONFIG } from './types';

/**
 * Compute the next stage for an observation, or null if no promotion is warranted.
 * Uses configurable thresholds for confirmations, age, and confidence.
 */
export function computePromotion(
    obs: Observation,
    age: number,
    confidence: number,
    config: Required<ConsolidationConfig> = DEFAULT_CONFIG,
): MemoryStage | null {
    const c = obs.evidence.confirmations;

    switch (obs.stage) {
        case 'observation':
            if (c >= config.observationToEpisode) return 'episode';
            break;

        case 'episode':
            if (c >= config.episodeToFact && age >= config.episodeToFactAge) return 'fact';
            break;

        case 'fact':
            if (c >= config.factToBelief &&
                age >= config.factToBeliefAge &&
                confidence >= config.factToBeliefConfidence) return 'belief';
            break;

        case 'belief':
            if (c >= config.beliefToTrait &&
                age >= config.beliefToTraitAge &&
                confidence >= config.beliefToTraitConfidence) return 'trait';
            break;

        case 'trait':
            break; // final stage
    }

    return null;
}

/**
 * Merge near-duplicate observations within an entity.
 * If one observation is a substring of another, merge evidence and keep the longer one.
 * Returns the number of merges performed.
 */
export function mergeNearDuplicates(observations: Observation[]): number {
    let mergeCount = 0;
    const toRemove = new Set<number>();

    for (let i = 0; i < observations.length; i++) {
        if (toRemove.has(i)) continue;

        for (let j = i + 1; j < observations.length; j++) {
            if (toRemove.has(j)) continue;

            const a = observations[i].content.toLowerCase().trim();
            const b = observations[j].content.toLowerCase().trim();

            const similar = a === b ||
                (a.length > 10 && b.includes(a)) ||
                (b.length > 10 && a.includes(b));

            if (similar) {
                const keepIdx = observations[i].content.length >= observations[j].content.length ? i : j;
                const discardIdx = keepIdx === i ? j : i;

                const keep = observations[keepIdx];
                const discard = observations[discardIdx];
                keep.evidence.confirmations += discard.evidence.confirmations;
                keep.evidence.sources = [...new Set([...keep.evidence.sources, ...discard.evidence.sources])];
                keep.evidence.lastConfirmedAt = Math.max(keep.evidence.lastConfirmedAt, discard.evidence.lastConfirmedAt);

                // Keep the higher stage
                const stageOrder: MemoryStage[] = ['observation', 'episode', 'fact', 'belief', 'trait'];
                if (stageOrder.indexOf(discard.stage) > stageOrder.indexOf(keep.stage)) {
                    keep.stage = discard.stage;
                }

                toRemove.add(discardIdx);
                mergeCount++;
            }
        }
    }

    // Remove merged observations (iterate in reverse)
    const removeArr = Array.from(toRemove).sort((a, b) => b - a);
    for (const idx of removeArr) {
        observations.splice(idx, 1);
    }

    return mergeCount;
}

/** Average confirmations across an array of observations. */
export function avgConfirmations(observations: Observation[]): number {
    if (observations.length === 0) return 0;
    const total = observations.reduce((sum, obs) => sum + obs.evidence.confirmations, 0);
    return total / observations.length;
}
