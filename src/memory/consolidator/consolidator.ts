/**
 * Consolidator — thin orchestrator for knowledge graph consolidation.
 *
 * Delegates to:
 *   - promotion.ts      (stage transitions, duplicate merging)
 *   - skills-synthesis.ts (extract skills from exchange patterns)
 *
 * @module memory/consolidator/consolidator
 */

import type { GraphState } from '../knowledge-graph';
import {
    computeConfidence, STAGE_WEIGHTS,
    getAllEntities, getAllRelations, getEntity, markConsolidated, getMeta,
} from '../knowledge-graph';
import type { SkillStore } from '../skills';
import type { VectorStore } from '../vector-store';
import type { ConsolidationConfig, ConsolidationResult } from './types';
import { DEFAULT_CONFIG } from './types';
import { computePromotion, mergeNearDuplicates, avgConfirmations } from './promotion';
import { synthesizeSkills } from './skills-synthesis';

export class Consolidator {
    private config: Required<ConsolidationConfig>;

    constructor(config?: ConsolidationConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Run a full consolidation pass on the knowledge graph.
     * Returns a summary of what was changed.
     */
    consolidate(graph: GraphState, skills?: SkillStore, vectorStore?: VectorStore): ConsolidationResult {
        const start = Date.now();
        let promoted = 0;
        let pruned = 0;
        let merged = 0;
        let skillsSynthesized = 0;

        const now = Date.now();
        const entities = getAllEntities(graph);

        for (const entity of entities) {
            const obsToRemove: number[] = [];

            for (let i = 0; i < entity.observations.length; i++) {
                const obs = entity.observations[i];

                // ── Pruning: remove low-confidence observations ──
                const confidence = computeConfidence(obs.evidence);
                if (confidence < this.config.pruneThreshold && obs.stage === 'observation') {
                    obsToRemove.push(i);
                    pruned++;
                    continue;
                }

                // ── Promotion logic ──
                const age = now - obs.createdAt;
                const newStage = computePromotion(obs, age, confidence, this.config);

                if (newStage && newStage !== obs.stage) {
                    obs.stage = newStage;
                    obs.evidence.sources = [...new Set([...obs.evidence.sources, 'consolidator'])];
                    promoted++;
                }
            }

            // ── Merge near-duplicate observations ──
            merged += mergeNearDuplicates(entity.observations);

            // Remove pruned observations (iterate in reverse)
            for (let i = obsToRemove.length - 1; i >= 0; i--) {
                entity.observations.splice(obsToRemove[i], 1);
            }
        }

        // ── Update relation weights after stage changes ──
        const relations = getAllRelations(graph);
        for (const rel of relations) {
            const newWeight = computeConfidence(rel.evidence) * STAGE_WEIGHTS[rel.stage];
            if (Math.abs(rel.weight - newWeight) > 0.01) {
                rel.weight = newWeight;
            }

            // Promote relation stages if connected entities have been promoted
            const fromEntity = getEntity(graph, rel.from);
            const toEntity = getEntity(graph, rel.to);
            if (fromEntity && toEntity) {
                const avg = (rel.evidence.confirmations +
                    avgConfirmations(fromEntity.observations) +
                    avgConfirmations(toEntity.observations)) / 3;

                if (avg >= this.config.episodeToFact && rel.stage === 'observation') {
                    rel.stage = 'episode';
                    promoted++;
                } else if (avg >= this.config.factToBelief && rel.stage === 'episode') {
                    rel.stage = 'fact';
                    promoted++;
                }
            }
        }

        // ── Skill synthesis ──
        if (skills && vectorStore) {
            skillsSynthesized = synthesizeSkills(vectorStore, skills);
        }

        markConsolidated(graph);

        const duration = Date.now() - start;
        if (promoted > 0 || pruned > 0 || merged > 0 || skillsSynthesized > 0) {
            console.log(
                `🧹 Consolidation: ${promoted} promoted, ${pruned} pruned, ${merged} merged, ${skillsSynthesized} skills | ${duration}ms`
            );
        }

        return { promoted, pruned, merged, skillsSynthesized, duration };
    }

    /** Check if consolidation should run (based on mutation count). */
    shouldRun(graph: GraphState): boolean {
        const meta = getMeta(graph);
        return meta.mutationsSinceConsolidation >= this.config.mutationThreshold;
    }
}
