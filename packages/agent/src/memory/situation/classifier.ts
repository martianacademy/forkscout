/**
 * Situation classifier — infers the active life-domain situation from a query.
 *
 * Uses keyword signals + entity-type affinity to produce a `SituationModel`
 * with soft domain activations. No LLM call needed — pure heuristic scoring.
 *
 * Also provides `buildAccessContext()` to snapshot the situation for storage
 * on accessed entities/chunks.
 *
 * @module situation/classifier
 */

import type { EntityType } from '../knowledge-graph';
import type { AccessContext, LifeDomain, SituationModel } from './types';
import { getDomainRegistry } from './registry';

/**
 * Classify the current situation based on query + recent context.
 *
 * Scores each registered domain by:
 * 1. Signal keyword matches in the query (weight 0.3 each)
 * 2. Signal matches in recent context but not query (weight 0.1 each)
 * 3. Entity type affinity (weight 0.15 per matching type)
 *
 * Falls back to `'knowledge'` (0.3) if nothing matched.
 *
 * @param query             - Current user query
 * @param recentMessages    - Last few messages for carry-over context
 * @param activeEntityTypes - Entity types mentioned in recent context
 * @returns SituationModel with soft domain activations
 *
 * @example
 * ```ts
 * const situation = classifySituation('what TypeScript version should I use?');
 * // situation.primary → ['knowledge', 'capability']
 * ```
 */
export function classifySituation(
    query: string,
    recentMessages: string[] = [],
    activeEntityTypes: EntityType[] = [],
): SituationModel {
    const weights = new Map<LifeDomain, number>();
    const registry = getDomainRegistry();

    // Combine query + recent context into a single analysis string
    const contextWindow = [query, ...recentMessages.slice(0, 5)].join(' ').toLowerCase();
    const queryLower = query.toLowerCase();

    // Score each domain by signal matches
    for (const [domain, descriptor] of registry) {
        let score = 0;

        // Signal keyword matches in query (strongest)
        for (const signal of descriptor.signals) {
            if (queryLower.includes(signal)) {
                score += 0.3;
            }
        }

        // Signal matches in recent context (weaker — situation carry-over)
        for (const signal of descriptor.signals) {
            if (contextWindow.includes(signal) && !queryLower.includes(signal)) {
                score += 0.1;
            }
        }

        // Entity type affinity (boost if active entities match this domain)
        for (const entityType of activeEntityTypes) {
            if (descriptor.entityAffinity.includes(entityType)) {
                score += 0.15;
            }
        }

        // Normalize: cap at 1.0, ignore negligible scores
        score = Math.min(score, 1.0);
        if (score > 0.05) {
            weights.set(domain, score);
        }
    }

    // If nothing matched strongly, default to knowledge (most general)
    if (weights.size === 0) {
        weights.set('knowledge', 0.3);
    }

    // Extract primary domains (top 3 by weight)
    const sorted = Array.from(weights.entries()).sort((a, b) => b[1] - a[1]);
    const primary = sorted.slice(0, 3).map(([domain]) => domain);

    // Infer goal from query
    const goal = inferGoal(queryLower, primary);

    return {
        domains: weights,
        goal,
        activeEntities: [],
        primary,
    };
}

/**
 * Infer a short goal description from the query and active domains.
 * Simple heuristic: first domain + truncated query.
 */
function inferGoal(query: string, primaryDomains: LifeDomain[]): string {
    const domain = primaryDomains[0] ?? 'knowledge';
    const shortQuery = query.slice(0, 80).replace(/[?!.]+$/, '').trim();
    return `${domain}: ${shortQuery}`;
}

/**
 * Build an `AccessContext` from the current situation model.
 * Stored on entities/chunks when they're accessed, enabling
 * future retrieval to understand *why* something was accessed.
 *
 * @param query     - The original user query
 * @param situation - The computed situation model
 * @returns An `AccessContext` snapshot
 *
 * @example
 * ```ts
 * const ctx = buildAccessContext('how do I deploy?', situation);
 * entity.lastAccessContext = ctx;
 * ```
 */
export function buildAccessContext(query: string, situation: SituationModel): AccessContext {
    const weights: Partial<Record<string, number>> = {};
    for (const [d, w] of situation.domains) {
        weights[d] = w;
    }
    return {
        intent: query.slice(0, 200),
        domains: situation.primary,
        weights,
    };
}
