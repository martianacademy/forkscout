/**
 * Domain boosting — re-ranks search results based on situation relevance.
 *
 * Provides multipliers that adjust entity and observation scores
 * depending on how well they align with the currently active life domains.
 *
 * - `domainBoost()` — entity-level boost by entity type
 * - `observationDomainBoost()` — observation-level boost by content signals
 *
 * @module situation/boost
 */

import type { EntityType } from '../knowledge-graph';
import type { SituationModel } from './types';
import { getDomainRegistry } from './registry';

/**
 * Get the domain affinity score for an entity type in the current situation.
 *
 * Returns a multiplier:
 * - `0.6` — no affinity (suppress)
 * - `1.0` — moderate affinity (neutral)
 * - `1.4` — strong affinity (boost)
 *
 * @param entityType - The entity's type (person, technology, …)
 * @param situation  - The active situation model
 * @returns A multiplier in range `[0.6, 1.4]`
 */
export function domainBoost(
    entityType: EntityType,
    situation: SituationModel,
): number {
    let maxAffinity = 0;
    const registry = getDomainRegistry();

    for (const [domain, weight] of situation.domains) {
        const descriptor = registry.get(domain);
        if (!descriptor) continue;

        if (descriptor.entityAffinity.includes(entityType)) {
            maxAffinity = Math.max(maxAffinity, weight);
        }
    }

    // Convert: 0 affinity → 0.6 multiplier (suppress), high affinity → up to 1.4
    return 0.6 + maxAffinity * 0.8;
}

/**
 * Compute domain boost for an observation based on its content.
 * Scans the observation text for domain signal keywords.
 *
 * Returns a multiplier:
 * - `0.7` — no signal match (mild suppress)
 * - `1.0` — moderate match
 * - `1.3` — strong match (mild boost)
 *
 * @param observationContent - The observation text to scan
 * @param situation          - The active situation model
 * @returns A multiplier in range `[0.7, 1.3]`
 */
export function observationDomainBoost(
    observationContent: string,
    situation: SituationModel,
): number {
    const obsLower = observationContent.toLowerCase();
    let maxScore = 0;
    const registry = getDomainRegistry();

    for (const [domain, weight] of situation.domains) {
        const descriptor = registry.get(domain);
        if (!descriptor) continue;

        let signalHits = 0;
        for (const signal of descriptor.signals) {
            if (obsLower.includes(signal)) signalHits++;
        }

        if (signalHits > 0) {
            // More signal hits = stronger match, weighted by domain activation
            const score = Math.min(signalHits * 0.3, 1.0) * weight;
            maxScore = Math.max(maxScore, score);
        }
    }

    // Convert: 0 → 0.7 (mild suppress), high → up to 1.3 (mild boost)
    return 0.7 + maxScore * 0.6;
}
