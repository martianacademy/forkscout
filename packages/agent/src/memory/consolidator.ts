/**
 * Knowledge Consolidator — promotes observations through the cognitive lifecycle.
 *
 * Stage lifecycle: observation → episode → fact → belief → trait
 *
 * Promotion rules (configurable):
 *   observation → episode: confirmations >= 2
 *   episode → fact:       confirmations >= 4 AND age > 1 day
 *   fact → belief:        confirmations >= 6 AND age > 7 days AND confidence > 0.7
 *   belief → trait:       confirmations >= 10 AND age > 30 days AND confidence > 0.85
 *
 * Also handles:
 *   - Pruning low-confidence observations (contradictions outweigh confirmations)
 *   - Merging duplicate/near-duplicate observations
 *   - Updating relation weights after promotion
 *   - Skill synthesis from repeated exchange patterns
 *
 * Runs automatically after N mutations or during memory flush.
 */

import type { GraphState } from './knowledge-graph';
import {
    computeConfidence, STAGE_WEIGHTS, type MemoryStage, type Observation,
    getAllEntities, getAllRelations, getEntity, markConsolidated, getMeta,
} from './knowledge-graph';
import type { SkillStore } from './skills';
import type { VectorStore } from './vector-store';

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

const DEFAULT_CONFIG: Required<ConsolidationConfig> = {
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
                    // Only prune raw observations, not promoted ones
                    obsToRemove.push(i);
                    pruned++;
                    continue;
                }

                // ── Promotion logic ──
                const age = now - obs.createdAt;
                const newStage = this.computePromotion(obs, age, confidence);

                if (newStage && newStage !== obs.stage) {
                    obs.stage = newStage;
                    obs.evidence.sources = [...new Set([...obs.evidence.sources, 'consolidator'])];
                    promoted++;
                }
            }

            // ── Merge near-duplicate observations ──
            merged += this.mergeNearDuplicates(entity.observations);

            // Remove pruned observations (iterate in reverse to preserve indices)
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

            // Promote relation stages if the connected entities have been promoted
            const fromEntity = getEntity(graph, rel.from);
            const toEntity = getEntity(graph, rel.to);
            if (fromEntity && toEntity) {
                const avgConfirmations = (rel.evidence.confirmations +
                    this.avgConfirmations(fromEntity.observations) +
                    this.avgConfirmations(toEntity.observations)) / 3;

                if (avgConfirmations >= this.config.episodeToFact && rel.stage === 'observation') {
                    rel.stage = 'episode';
                    promoted++;
                } else if (avgConfirmations >= this.config.factToBelief && rel.stage === 'episode') {
                    rel.stage = 'fact';
                    promoted++;
                }
            }
        }

        // ── Skill synthesis from vector store ──
        if (skills && vectorStore) {
            skillsSynthesized = this.synthesizeSkills(vectorStore, skills);
        }

        // Mark consolidation in graph metadata
        markConsolidated(graph);

        const duration = Date.now() - start;

        if (promoted > 0 || pruned > 0 || merged > 0 || skillsSynthesized > 0) {
            console.log(
                `🧹 Consolidation: ${promoted} promoted, ${pruned} pruned, ${merged} merged, ${skillsSynthesized} skills | ${duration}ms`
            );
        }

        return { promoted, pruned, merged, skillsSynthesized, duration };
    }

    /**
     * Check if consolidation should run (based on mutation count).
     */
    shouldRun(graph: GraphState): boolean {
        const meta = getMeta(graph);
        return meta.mutationsSinceConsolidation >= this.config.mutationThreshold;
    }

    // ── Private helpers ──────────────────────────────────

    /** Compute the next stage for an observation, or null if no promotion */
    private computePromotion(obs: Observation, age: number, confidence: number): MemoryStage | null {
        const c = obs.evidence.confirmations;

        switch (obs.stage) {
            case 'observation':
                if (c >= this.config.observationToEpisode) return 'episode';
                break;

            case 'episode':
                if (c >= this.config.episodeToFact && age >= this.config.episodeToFactAge) return 'fact';
                break;

            case 'fact':
                if (c >= this.config.factToBelief &&
                    age >= this.config.factToBeliefAge &&
                    confidence >= this.config.factToBeliefConfidence) return 'belief';
                break;

            case 'belief':
                if (c >= this.config.beliefToTrait &&
                    age >= this.config.beliefToTraitAge &&
                    confidence >= this.config.beliefToTraitConfidence) return 'trait';
                break;

            case 'trait':
                // Traits are the final stage — no further promotion
                break;
        }

        return null;
    }

    /**
     * Merge near-duplicate observations within an entity.
     * Uses simple substring matching — if one observation is a substring of another,
     * merge their evidence and keep the longer one.
     */
    private mergeNearDuplicates(observations: Observation[]): number {
        let mergeCount = 0;
        const toRemove = new Set<number>();

        for (let i = 0; i < observations.length; i++) {
            if (toRemove.has(i)) continue;

            for (let j = i + 1; j < observations.length; j++) {
                if (toRemove.has(j)) continue;

                const a = observations[i].content.toLowerCase().trim();
                const b = observations[j].content.toLowerCase().trim();

                // Check if one is contained in the other (or very similar)
                const similar = a === b ||
                    (a.length > 10 && b.includes(a)) ||
                    (b.length > 10 && a.includes(b));

                if (similar) {
                    // Keep the longer/higher-stage one
                    const keepIdx = observations[i].content.length >= observations[j].content.length ? i : j;
                    const discardIdx = keepIdx === i ? j : i;

                    // Merge evidence
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

    /** Average confirmations across observations */
    private avgConfirmations(observations: Observation[]): number {
        if (observations.length === 0) return 0;
        const total = observations.reduce((sum, obs) => sum + obs.evidence.confirmations, 0);
        return total / observations.length;
    }

    /**
     * Synthesize skills from repeated exchange patterns in the vector store.
     * Looks for exchanges that share similar tool usage patterns and
     * extracts reusable skill templates.
     */
    private synthesizeSkills(vectorStore: VectorStore, skills: SkillStore): number {
        // Get unconsolidated exchanges
        const chunks = vectorStore.getUnconsolidated();
        if (chunks.length < 5) return 0; // Not enough data

        // Group by keyword patterns for simple skill detection
        const patternGroups = new Map<string, string[]>();

        for (const chunk of chunks) {
            const text = chunk.text.toLowerCase();
            // Extract action keywords
            const keywords: string[] = [];
            if (text.includes('search') || text.includes('web_search')) keywords.push('web-search');
            if (text.includes('run_command') || text.includes('execute')) keywords.push('command');
            if (text.includes('file') && (text.includes('read') || text.includes('write'))) keywords.push('file-ops');
            if (text.includes('knowledge') || text.includes('memory')) keywords.push('memory');
            if (text.includes('telegram') || text.includes('send_message')) keywords.push('telegram');

            if (keywords.length > 0) {
                const key = keywords.sort().join('+');
                const list = patternGroups.get(key) || [];
                list.push(chunk.text.slice(0, 300));
                patternGroups.set(key, list);
            }

            // Mark as consolidated
            chunk.consolidated = true;
        }

        // Create skills for patterns that appear >= 3 times
        let synthesized = 0;
        for (const [pattern, instances] of patternGroups) {
            if (instances.length >= 3 && !skills.hasSkill(pattern)) {
                const examples = instances.slice(0, 3).map((e, i) => `Example ${i + 1}: ${e.slice(0, 150)}`).join('\n');
                skills.addSkill({
                    id: pattern,
                    name: pattern.replace(/\+/g, ' + '),
                    intent: `User wants to perform: ${pattern.replace(/\+/g, ', ')}`,
                    steps: [`Pattern detected from ${instances.length} similar exchanges`, examples],
                    successRate: Math.min(0.5 + instances.length * 0.1, 0.95),
                    lastUsed: Date.now(),
                    evidenceCount: instances.length,
                    derivedFrom: [],
                });
                synthesized++;
            }
        }

        return synthesized;
    }
}
