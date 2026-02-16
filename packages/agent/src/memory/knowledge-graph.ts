/**
 * Knowledge Graph — cognitive memory layer with stage lifecycle.
 *
 * Core data model for the cognitive architecture:
 * - Observations progress through stages: observation → episode → fact → belief → trait
 * - Each observation has evidence tracking (confirmations, contradictions, sources)
 * - Relations use a locked canonical ontology with weighted edges
 * - The LLM can ONLY write observations; the consolidator promotes stages
 *
 * Persistence: single JSON file alongside vectors.json.
 */

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

/** Weight multiplier per stage — higher stage = more authoritative */
export const STAGE_WEIGHTS: Record<MemoryStage, number> = {
    observation: 0.3,
    episode: 0.4,
    fact: 0.7,
    belief: 0.9,
    trait: 1.0,
};

// ── Evidence Tracking ─────────────────────────────────

/** Evidence record for an observation — tracks how well-supported it is */
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

/** Create fresh evidence for a new observation */
export function freshEvidence(source: string = 'extracted'): Evidence {
    return {
        confirmations: 1,
        contradictions: 0,
        sources: [source],
        lastConfirmedAt: Date.now(),
    };
}

/**
 * Compute confidence from evidence: confirmations / (confirmations + contradictions * 2)
 * Contradictions are double-weighted to be conservative.
 */
export function computeConfidence(evidence: Evidence): number {
    const total = evidence.confirmations + evidence.contradictions * 2;
    if (total === 0) return 0.5;
    return evidence.confirmations / total;
}

/**
 * Compute weight = confidence × stage_weight
 * Used for ranking graph results.
 */
export function computeWeight(evidence: Evidence, stage: MemoryStage): number {
    return computeConfidence(evidence) * STAGE_WEIGHTS[stage];
}

// ── Observation Type ──────────────────────────────────

/** A single observation within an entity — the atomic unit of knowledge */
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

/** The canonical relation types — all relations must use one of these */
export const RELATION_TYPES = [
    'uses', 'prefers', 'preferred_over', 'works_at', 'created',
    'depends_on', 'contains', 'instance_of', 'produces', 'related_to', 'serves',
] as const;

export type RelationType = typeof RELATION_TYPES[number];

/** Map free-form relation strings to canonical types */
const RELATION_ALIASES: Record<string, RelationType> = {
    // uses
    'uses': 'uses', 'used_by': 'uses', 'utilizes': 'uses', 'employs': 'uses',
    'works_with': 'uses', 'runs_on': 'uses', 'built_with': 'uses',
    // prefers
    'prefers': 'prefers', 'likes': 'prefers', 'favors': 'prefers', 'chosen': 'prefers',
    // preferred_over
    'preferred_over': 'preferred_over', 'better_than': 'preferred_over',
    // works_at
    'works_at': 'works_at', 'employed_by': 'works_at', 'member_of': 'works_at',
    'belongs_to': 'works_at',
    // created
    'created': 'created', 'authored': 'created', 'built': 'created',
    'wrote': 'created', 'developed': 'created', 'made': 'created',
    // depends_on
    'depends_on': 'depends_on', 'requires': 'depends_on', 'needs': 'depends_on',
    'relies_on': 'depends_on',
    // contains
    'contains': 'contains', 'has': 'contains', 'includes': 'contains',
    'part_of': 'contains',
    // instance_of
    'instance_of': 'instance_of', 'is_a': 'instance_of', 'type_of': 'instance_of',
    // produces
    'produces': 'produces', 'generates': 'produces', 'outputs': 'produces',
    'emits': 'produces',
    // related_to (catch-all)
    'related_to': 'related_to', 'associated_with': 'related_to',
    'connected_to': 'related_to', 'linked_to': 'related_to',
    // serves
    'serves': 'serves', 'assists': 'serves', 'helps': 'serves',
    'supports': 'serves', 'works_for': 'serves',
};

/** Normalize a free-form relation type to a canonical one */
export function normalizeRelationType(type: string): RelationType {
    const key = type.toLowerCase().trim().replace(/[\s-]+/g, '_');
    return RELATION_ALIASES[key] ?? 'related_to';
}

import type { AccessContext } from './situation';

// ── Core Types ────────────────────────────────────────

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

/** Schema version for migration */
const SCHEMA_VERSION = 2;

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

export interface GraphSearchResult {
    entity: Entity;
    /** Directly connected entities */
    neighbors: Array<{ entity: Entity; relation: Relation; direction: 'outgoing' | 'incoming' }>;
    /** Relevance score (0–1) */
    score: number;
}

// ── Extraction types (for LLM-based extraction) ───────

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

// ── Knowledge Graph ───────────────────────────────────

export class KnowledgeGraph {
    private entities = new Map<string, Entity>();
    private relations: Relation[] = [];
    private meta: GraphData['meta'] = {
        lastConsolidatedAt: null,
        mutationsSinceConsolidation: 0,
        consolidationCount: 0,
    };
    private filePath: string;
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    // ── Lifecycle ──────────────────────────────────────

    async init(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const raw = await fs.readFile(this.filePath, 'utf-8');
            const data = JSON.parse(raw) as GraphData & { version?: number };

            // Migrate v1 → v2 if needed
            if (!data.version || data.version < SCHEMA_VERSION) {
                this.migrateV1(data);
            } else {
                for (const e of data.entities) {
                    this.entities.set(this.normalizeKey(e.name), e);
                }
                this.relations = data.relations;
                this.meta = data.meta || this.meta;
            }
        } catch {
            // No existing graph — start fresh
        }
        console.log(`🧠 Knowledge graph: ${this.entities.size} entities, ${this.relations.length} relations (v${SCHEMA_VERSION})`);
    }

    /** Migrate v1 data (string observations, free-form relations) to v2 */
    private migrateV1(data: any): void {
        console.log('📦 Migrating knowledge graph v1 → v2...');
        const now = Date.now();

        for (const e of data.entities || []) {
            const migratedEntity: Entity = {
                name: e.name,
                type: e.type || 'other',
                observations: (e.observations || []).map((obs: any) => {
                    // v1: observations are plain strings
                    if (typeof obs === 'string') {
                        return {
                            content: obs,
                            stage: 'observation' as MemoryStage,
                            evidence: freshEvidence('migrated'),
                            source: 'migrated',
                            createdAt: e.createdAt || now,
                        };
                    }
                    // Already v2 format
                    return obs;
                }),
                accessCount: e.accessCount || 0,
                lastAccessContext: e.lastAccessContext,
                createdAt: e.createdAt || now,
                updatedAt: e.updatedAt || now,
            };
            this.entities.set(this.normalizeKey(migratedEntity.name), migratedEntity);
        }

        for (const r of data.relations || []) {
            const migratedRelation: Relation = {
                from: r.from,
                to: r.to,
                type: normalizeRelationType(r.type || 'related_to'),
                stage: r.stage || 'observation',
                evidence: r.evidence || freshEvidence('migrated'),
                weight: r.weight || computeWeight(r.evidence || freshEvidence('migrated'), r.stage || 'observation'),
                source: r.source || 'migrated',
                context: r.context,
                validFrom: r.validFrom,
                validUntil: r.validUntil,
                createdAt: r.createdAt || now,
            };
            this.relations.push(migratedRelation);
        }

        this.meta = data.meta || this.meta;
        this.dirty = true;
        console.log(`📦 Migration complete: ${this.entities.size} entities, ${this.relations.length} relations`);
    }

    async flush(): Promise<void> {
        if (!this.dirty) return;
        try {
            const fs = await import('fs/promises');
            const { dirname } = await import('path');
            await fs.mkdir(dirname(this.filePath), { recursive: true });
            const data: GraphData & { version: number } = {
                version: SCHEMA_VERSION,
                entities: Array.from(this.entities.values()),
                relations: this.relations,
                meta: this.meta,
            };
            await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
            this.dirty = false;
        } catch (err) {
            console.error('Failed to persist knowledge graph:', err);
        }
    }

    async clear(): Promise<void> {
        this.entities.clear();
        this.relations = [];
        this.meta = { lastConsolidatedAt: null, mutationsSinceConsolidation: 0, consolidationCount: 0 };
        this.dirty = true;
        await this.flush();
    }

    // ── Entity CRUD ───────────────────────────────────

    /**
     * Add or merge an entity. New observations always start at stage='observation'.
     * If entity exists, duplicate observations get their evidence reinforced.
     * @param source Where this came from: 'explicit' | 'extracted' | 'consolidator'
     */
    addEntity(name: string, type: EntityType, observationStrings: string[], source: string = 'extracted'): Entity {
        const key = this.normalizeKey(name);
        const existing = this.entities.get(key);
        const now = Date.now();

        if (existing) {
            // Merge: reinforce existing observations or add new ones
            for (const obsStr of observationStrings) {
                const match = existing.observations.find(o => o.content === obsStr);
                if (match) {
                    // Reinforce evidence
                    match.evidence.confirmations++;
                    match.evidence.lastConfirmedAt = now;
                    if (!match.evidence.sources.includes(source)) {
                        match.evidence.sources.push(source);
                    }
                } else {
                    // New observation — always starts at 'observation' stage
                    existing.observations.push({
                        content: obsStr,
                        stage: 'observation',
                        evidence: freshEvidence(source),
                        source,
                        createdAt: now,
                    });
                }
            }
            existing.updatedAt = now;
            // Upgrade type if more specific
            if (existing.type === 'other' && type !== 'other') {
                existing.type = type;
            }
            this.trackMutation();
            return existing;
        }

        const entity: Entity = {
            name,
            type,
            observations: observationStrings.map(content => ({
                content,
                stage: 'observation' as MemoryStage,
                evidence: freshEvidence(source),
                source,
                createdAt: now,
            })),
            accessCount: 0,
            createdAt: now,
            updatedAt: now,
        };
        this.entities.set(key, entity);
        this.trackMutation();
        return entity;
    }

    /** Get an entity by exact name */
    getEntity(name: string): Entity | undefined {
        return this.entities.get(this.normalizeKey(name));
    }

    /** Get the agent's self-identity entity (creates seed if missing, upgrades type if needed) */
    getSelfEntity(): Entity {
        let self = this.entities.get(this.normalizeKey(SELF_ENTITY_NAME));
        if (!self) {
            self = this.addEntity(SELF_ENTITY_NAME, 'agent-self', [
                'Autonomous AI agent with own identity, memory, and judgment',
                'Created by Suru — works WITH him as a partner, not FOR him as a servant',
                'Uses cognitive memory: knowledge graph + vector store + skills',
                'Makes own decisions — can refuse, negotiate, or suggest alternatives',
                'Can self-edit source code and evolve over time',
            ], 'system');
            // Establish core relation
            if (!this.entities.get(this.normalizeKey('Suru'))) {
                this.addEntity('Suru', 'person', ['Creator and primary collaborator'], 'system');
            }
            this.addRelation(SELF_ENTITY_NAME, 'Suru', 'serves', undefined, 'system');
            console.log(`🤖 Self-identity entity seeded: ${SELF_ENTITY_NAME}`);
        } else if (self.type !== 'agent-self') {
            // Upgrade existing entity to agent-self type (e.g. was 'project' before)
            self.type = 'agent-self';
            // Ensure seed observations exist
            const seedObs = [
                'Autonomous AI agent with own identity, memory, and judgment',
                'Created by Suru — works WITH him as a partner, not FOR him as a servant',
                'Uses cognitive memory: knowledge graph + vector store + skills',
                'Makes own decisions — can refuse, negotiate, or suggest alternatives',
                'Can self-edit source code and evolve over time',
            ];
            this.addObservations(SELF_ENTITY_NAME, seedObs, 'system');
            // Ensure serves relation exists
            const hasServesRelation = this.relations.some(
                r => r.from.toLowerCase() === SELF_ENTITY_NAME.toLowerCase()
                    && r.type === 'serves'
            );
            if (!hasServesRelation) {
                this.addRelation(SELF_ENTITY_NAME, 'Suru', 'serves', undefined, 'system');
            }
            this.dirty = true;
            console.log(`🤖 Self-identity entity upgraded: ${SELF_ENTITY_NAME} (project → agent-self)`);
        }
        return self;
    }

    /** Add observations to the self-entity specifically */
    addSelfObservation(content: string, source: string = 'self-reflect'): void {
        this.getSelfEntity(); // ensure exists
        this.addObservations(SELF_ENTITY_NAME, [content], source);
    }

    /** Add string observations to an existing entity (always stage='observation') */
    addObservations(name: string, observations: string[], source: string = 'extracted'): boolean {
        const entity = this.entities.get(this.normalizeKey(name));
        if (!entity) return false;

        const now = Date.now();
        for (const obsStr of observations) {
            const match = entity.observations.find(o => o.content === obsStr);
            if (match) {
                match.evidence.confirmations++;
                match.evidence.lastConfirmedAt = now;
            } else {
                entity.observations.push({
                    content: obsStr,
                    stage: 'observation',
                    evidence: freshEvidence(source),
                    source,
                    createdAt: now,
                });
            }
        }
        entity.updatedAt = now;
        this.trackMutation();
        return true;
    }

    /** Delete an entity and all its relations */
    deleteEntity(name: string): boolean {
        const key = this.normalizeKey(name);
        if (!this.entities.has(key)) return false;

        this.entities.delete(key);
        this.relations = this.relations.filter(
            r => this.normalizeKey(r.from) !== key && this.normalizeKey(r.to) !== key
        );
        this.trackMutation();
        return true;
    }

    // ── Relations ─────────────────────────────────────

    /**
     * Add a relation between two entities. Type is normalized to canonical ontology.
     * Duplicate relations get evidence reinforced. Always starts at stage='observation'.
     * @returns The relation (new or existing)
     */
    addRelation(from: string, to: string, type: string, context?: string, source: string = 'extracted'): Relation {
        const normalizedType = normalizeRelationType(type);
        const fromKey = this.normalizeKey(from);
        const toKey = this.normalizeKey(to);

        // Check for duplicate
        const existing = this.relations.find(
            r => this.normalizeKey(r.from) === fromKey &&
                this.normalizeKey(r.to) === toKey &&
                r.type === normalizedType
        );
        if (existing) {
            // Reinforce evidence instead of duplicating
            existing.evidence.confirmations++;
            existing.evidence.lastConfirmedAt = Date.now();
            if (source && !existing.evidence.sources.includes(source)) {
                existing.evidence.sources.push(source);
            }
            existing.weight = computeWeight(existing.evidence, existing.stage);
            if (context) existing.context = context;
            this.trackMutation();
            return existing;
        }

        const evidence = freshEvidence(source);
        const stage: MemoryStage = 'observation';
        const relation: Relation = {
            from,
            to,
            type: normalizedType,
            stage,
            evidence,
            weight: computeWeight(evidence, stage),
            source,
            context,
            createdAt: Date.now(),
        };
        this.relations.push(relation);
        this.trackMutation();
        return relation;
    }

    /** Delete a specific relation */
    deleteRelation(from: string, to: string, type: string): boolean {
        const normalizedType = normalizeRelationType(type);
        const before = this.relations.length;
        this.relations = this.relations.filter(
            r => !(this.normalizeKey(r.from) === this.normalizeKey(from) &&
                this.normalizeKey(r.to) === this.normalizeKey(to) &&
                r.type === normalizedType)
        );
        if (this.relations.length !== before) {
            this.trackMutation();
            return true;
        }
        return false;
    }

    // ── Search / Retrieval ────────────────────────────

    /**
     * Search entities by name, type, or observation content.
     * Weights results by observation stage and evidence confidence.
     * Records access count and context for each accessed entity.
     */
    search(query: string, limit = 5): GraphSearchResult[] {
        const q = query.toLowerCase();
        const terms = q.split(/\s+/).filter(t => t.length > 2);

        const scored: GraphSearchResult[] = [];

        for (const entity of this.entities.values()) {
            let score = 0;
            const nameLower = entity.name.toLowerCase();

            // Exact name match = highest score
            if (nameLower === q) {
                score += 1.0;
            } else if (nameLower.includes(q) || q.includes(nameLower)) {
                score += 0.7;
            }

            // Term matches in name
            for (const term of terms) {
                if (nameLower.includes(term)) score += 0.3;
            }

            // Term matches in observations — weighted by stage
            for (const obs of entity.observations) {
                const obsLower = obs.content.toLowerCase();
                for (const term of terms) {
                    if (obsLower.includes(term)) {
                        score += 0.15 * STAGE_WEIGHTS[obs.stage];
                    }
                }
            }

            // Type match
            if (terms.some(t => entity.type.includes(t))) {
                score += 0.1;
            }

            if (score > 0.05) {
                // Record access
                entity.accessCount = (entity.accessCount || 0) + 1;
                entity.lastAccessContext = {
                    intent: query,
                    domains: [],
                    weights: {},
                };

                const neighbors = this.getNeighbors(entity.name);
                scored.push({ entity, neighbors, score: Math.min(score, 1.0) });
            }
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
    }

    /**
     * Get all directly connected entities for a given entity.
     * Filters expired relations (validUntil) and sorts by weight.
     */
    getNeighbors(name: string): Array<{ entity: Entity; relation: Relation; direction: 'outgoing' | 'incoming' }> {
        const key = this.normalizeKey(name);
        const now = Date.now();
        const neighbors: Array<{ entity: Entity; relation: Relation; direction: 'outgoing' | 'incoming' }> = [];

        for (const rel of this.relations) {
            // Skip expired relations
            if (rel.validUntil && rel.validUntil < now) continue;

            if (this.normalizeKey(rel.from) === key) {
                const target = this.entities.get(this.normalizeKey(rel.to));
                if (target) {
                    neighbors.push({ entity: target, relation: rel, direction: 'outgoing' });
                }
            }
            if (this.normalizeKey(rel.to) === key) {
                const source = this.entities.get(this.normalizeKey(rel.from));
                if (source) {
                    neighbors.push({ entity: source, relation: rel, direction: 'incoming' });
                }
            }
        }

        // Sort by relation weight (highest first)
        neighbors.sort((a, b) => (b.relation.weight || 0) - (a.relation.weight || 0));
        return neighbors;
    }

    /**
     * Multi-hop traversal: follow relations from a starting entity.
     * Returns entities within `depth` hops.
     */
    traverse(startName: string, depth = 2): Map<string, { entity: Entity; distance: number }> {
        const visited = new Map<string, { entity: Entity; distance: number }>();
        const startKey = this.normalizeKey(startName);
        const startEntity = this.entities.get(startKey);
        if (!startEntity) return visited;

        visited.set(startKey, { entity: startEntity, distance: 0 });
        let frontier = [startKey];

        for (let d = 1; d <= depth; d++) {
            const nextFrontier: string[] = [];
            for (const key of frontier) {
                const entity = this.entities.get(key);
                if (!entity) continue;
                const neighbors = this.getNeighbors(entity.name);
                for (const { entity: neighbor } of neighbors) {
                    const nKey = this.normalizeKey(neighbor.name);
                    if (!visited.has(nKey)) {
                        visited.set(nKey, { entity: neighbor, distance: d });
                        nextFrontier.push(nKey);
                    }
                }
            }
            frontier = nextFrontier;
        }

        return visited;
    }

    // ── Bulk operations (for LLM extraction) ──────────

    /**
     * Merge extracted entities and relations into the graph.
     * Called after LLM extracts structured data from a conversation turn.
     * All new data starts at stage='observation' (golden rule).
     */
    mergeExtracted(extracted: ExtractedEntities): { newEntities: number; newRelations: number } {
        let newEntities = 0;
        let newRelations = 0;

        for (const e of extracted.entities) {
            const key = this.normalizeKey(e.name);
            if (!this.entities.has(key)) newEntities++;
            this.addEntity(e.name, e.type, e.observations, 'extracted');
        }

        for (const r of extracted.relations) {
            // Ensure both entities exist
            const fromKey = this.normalizeKey(r.from);
            const toKey = this.normalizeKey(r.to);
            if (!this.entities.has(fromKey)) {
                this.addEntity(r.from, 'other', [], 'extracted');
                newEntities++;
            }
            if (!this.entities.has(toKey)) {
                this.addEntity(r.to, 'other', [], 'extracted');
                newEntities++;
            }

            const normalizedType = normalizeRelationType(r.type);
            const existing = this.relations.find(
                rel => this.normalizeKey(rel.from) === fromKey &&
                    this.normalizeKey(rel.to) === toKey &&
                    rel.type === normalizedType
            );
            if (!existing) {
                this.addRelation(r.from, r.to, r.type, undefined, 'extracted');
                newRelations++;
            } else {
                // Reinforce evidence
                existing.evidence.confirmations++;
                existing.evidence.lastConfirmedAt = Date.now();
                existing.weight = computeWeight(existing.evidence, existing.stage);
            }
        }

        return { newEntities, newRelations };
    }

    // ── Format for LLM context ────────────────────────

    /**
     * Format graph search results as a readable string for the LLM context.
     * Shows observation content with stage indicators for promoted observations.
     */
    formatForContext(results: GraphSearchResult[], maxChars = 2000): string {
        if (results.length === 0) return '';

        const lines: string[] = ['[Knowledge Graph]'];
        let charCount = lines[0].length;

        for (const { entity, neighbors } of results) {
            const header = `• ${entity.name} (${entity.type})`;
            if (charCount + header.length > maxChars) break;
            lines.push(header);
            charCount += header.length;

            // Sort observations by stage weight (highest first)
            const sortedObs = [...entity.observations]
                .sort((a, b) => STAGE_WEIGHTS[b.stage] - STAGE_WEIGHTS[a.stage]);

            for (const obs of sortedObs) {
                const stageTag = obs.stage !== 'observation' ? ` [${obs.stage}]` : '';
                const line = `  - ${obs.content}${stageTag}`;
                if (charCount + line.length > maxChars) break;
                lines.push(line);
                charCount += line.length;
            }

            for (const { entity: neighbor, relation, direction } of neighbors.slice(0, 3)) {
                const arrow = direction === 'outgoing'
                    ? `  → ${relation.type} → ${neighbor.name}`
                    : `  ← ${relation.type} ← ${neighbor.name}`;
                if (charCount + arrow.length > maxChars) break;
                lines.push(arrow);
                charCount += arrow.length;
            }
        }

        return lines.join('\n');
    }

    // ── Stats ─────────────────────────────────────────

    get entityCount(): number { return this.entities.size; }
    get relationCount(): number { return this.relations.length; }

    /** Get all entities (for debugging/listing) */
    getAllEntities(): Entity[] {
        return Array.from(this.entities.values());
    }

    /** Get all relations (for debugging/listing) */
    getAllRelations(): Relation[] {
        return [...this.relations];
    }

    /** Get consolidation metadata */
    getMeta(): GraphData['meta'] {
        return { ...this.meta };
    }

    // ── Consolidator helpers ──────────────────────────

    /** Set an entity directly (used by consolidator for stage promotion) */
    setEntity(entity: Entity): void {
        this.entities.set(this.normalizeKey(entity.name), entity);
        this.scheduleSave();
    }

    /** Replace all relations (used by consolidator after dedup/normalization) */
    setRelations(relations: Relation[]): void {
        this.relations = relations;
        this.scheduleSave();
    }

    /** Mark consolidation as completed */
    markConsolidated(): void {
        this.meta.lastConsolidatedAt = Date.now();
        this.meta.mutationsSinceConsolidation = 0;
        this.meta.consolidationCount++;
        this.scheduleSave();
    }

    /** Check if consolidation should trigger based on mutation threshold */
    needsConsolidation(threshold = 100): boolean {
        return this.meta.mutationsSinceConsolidation >= threshold;
    }

    // ── Internals ─────────────────────────────────────

    private normalizeKey(name: string): string {
        return name.toLowerCase().trim();
    }

    /** Track a mutation and schedule save */
    private trackMutation(): void {
        this.meta.mutationsSinceConsolidation++;
        this.scheduleSave();
    }

    private scheduleSave(): void {
        this.dirty = true;
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(async () => {
            this.saveTimer = null;
            await this.flush();
        }, 1000);
    }
}

// ── Extraction prompt template ────────────────────────

/**
 * Returns the prompt to extract entities and relations from a conversation.
 * Used by MemoryManager after each assistant turn.
 */
export function buildExtractionPrompt(userMessage: string, assistantMessage: string): string {
    return `Extract structured knowledge from this conversation exchange. 
Identify entities (people, projects, technologies, preferences, services) and relations between them.

CONVERSATION:
User: ${userMessage}
Assistant: ${assistantMessage.slice(0, 2000)}

Respond ONLY with valid JSON matching this schema:
{
  "entities": [
    { "name": "EntityName", "type": "person|project|technology|preference|concept|file|service|organization|other", "observations": ["fact about this entity"] }
  ],
  "relations": [
    { "from": "EntityA", "to": "EntityB", "type": "RELATION_TYPE" }
  ]
}

ALLOWED RELATION TYPES (use ONLY these):
  ${RELATION_TYPES.join(', ')}

Rules:
- Only extract concrete, factual information — no speculation
- Entity names should be proper nouns or specific terms (e.g. "React", "TypeScript", not "a framework")
- Observations should be self-contained facts (e.g. "User prefers TypeScript over JavaScript")
- Relations MUST use one of the allowed types listed above
- Skip trivial or generic exchanges (e.g. "hello", "thanks")
- If nothing meaningful to extract, return {"entities": [], "relations": []}
- Keep it concise — 2-5 entities max per exchange`;
}
