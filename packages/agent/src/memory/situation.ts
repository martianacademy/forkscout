/**
 * Situation Classifier — domain-aware retrieval lens.
 *
 * Instead of organizing memory by topic (programming, sports, food),
 * we organize by *why* the memory matters right now — the active life situation.
 *
 * Domains are not storage labels — they are retrieval lenses.
 * The same memory ("User prefers TypeScript") surfaces differently depending
 * on whether we're planning a project (planning+capability) or buying a gift (social+identity).
 *
 * The domain registry is extensible: the agent can discover and register new
 * domains when it encounters situations that don't fit existing ones.
 *
 * Built-in domains follow the universal life-context model:
 *   identity, preference, capability, knowledge, planning,
 *   episodic, social, environment, instinct, emotional, creative, routine
 */

import type { EntityType } from './knowledge-graph';

// ── Life Domain Types ─────────────────────────────────

/** Built-in life domains — the universal situations a mind encounters */
export const BUILT_IN_DOMAINS = [
    'identity',     // who/relationship — "who is this person?"
    'preference',   // likes/dislikes — "what do they like?"
    'capability',   // skills/ability — "can they fix this?"
    'knowledge',    // factual info — "what is Rust?"
    'planning',     // deciding actions — "what should we do?"
    'episodic',     // past events — "what happened earlier?"
    'social',       // interaction tone — "how should I respond?"
    'environment',  // current situation — "what changed?"
    'instinct',     // gut/urgency — "something feels wrong", "act fast"
    'emotional',    // emotional state — "user seems frustrated"
    'creative',     // brainstorming — "let's explore ideas"
    'routine',      // habitual patterns — "how do I usually do this?"
] as const;

export type BuiltInDomain = typeof BUILT_IN_DOMAINS[number];

/** A life domain can be built-in or dynamically discovered */
export type LifeDomain = BuiltInDomain | string;

// ── Domain Metadata Registry ──────────────────────────

/** Description and signal patterns for a domain */
export interface DomainDescriptor {
    /** Human-readable description of when this domain activates */
    description: string;
    /** Keywords/phrases that signal this domain is active */
    signals: string[];
    /** Entity types that have natural affinity with this domain */
    entityAffinity: EntityType[];
    /** Whether this is a built-in or discovered domain */
    builtIn: boolean;
}

/** The domain registry — extensible at runtime */
const DOMAIN_REGISTRY = new Map<LifeDomain, DomainDescriptor>();

// Register all built-in domains
function registerBuiltIns(): void {
    DOMAIN_REGISTRY.set('identity', {
        description: 'Who someone is, relationships, self-concept',
        signals: [
            'who is', 'who am i', 'about me', 'my name', 'tell me about',
            'introduce', 'background', 'role', 'title', 'describe',
        ],
        entityAffinity: ['person', 'organization'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('preference', {
        description: 'Likes, dislikes, favorites, choices, taste',
        signals: [
            'prefer', 'favorite', 'like', 'dislike', 'hate', 'love',
            'choose', 'better', 'worse', 'rather', 'instead', 'enjoy',
            'taste', 'opinion',
        ],
        entityAffinity: ['preference', 'technology'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('capability', {
        description: 'Skills, abilities, what someone/something can do',
        signals: [
            'can you', 'able to', 'how to', 'skill', 'capability',
            'know how', 'experience with', 'proficient', 'fix', 'solve',
            'implement', 'build', 'create', 'handle',
        ],
        entityAffinity: ['technology', 'service', 'person'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('knowledge', {
        description: 'Factual information, definitions, explanations',
        signals: [
            'what is', 'explain', 'define', 'how does', 'why does',
            'meaning', 'concept', 'difference between', 'compare',
            'documentation', 'specification', 'version',
        ],
        entityAffinity: ['technology', 'concept', 'project'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('planning', {
        description: 'Deciding actions, strategy, next steps, goals',
        signals: [
            'should we', 'plan', 'next step', 'strategy', 'goal',
            'decide', 'approach', 'roadmap', 'priority', 'todo',
            'what to do', 'should i', 'let\'s', 'implement',
        ],
        entityAffinity: ['project', 'technology', 'service'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('episodic', {
        description: 'Past events, what happened, history, recall',
        signals: [
            'remember', 'last time', 'earlier', 'yesterday', 'before',
            'happened', 'did we', 'history', 'when did', 'ago',
            'previously', 'back when', 'recall',
        ],
        entityAffinity: ['project', 'person'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('social', {
        description: 'Interaction tone, relationships, how to respond',
        signals: [
            'surprise', 'gift', 'birthday', 'thank', 'sorry',
            'feel', 'mood', 'relationship', 'team', 'collaborate',
            'help someone', 'introduce to', 'recommend to',
        ],
        entityAffinity: ['person', 'organization'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('environment', {
        description: 'Current situation, context changes, workspace state',
        signals: [
            'changed', 'broken', 'updated', 'new version', 'deployed',
            'environment', 'config', 'setup', 'status', 'currently',
            'running', 'installed', 'error', 'crash', 'log',
        ],
        entityAffinity: ['service', 'file', 'project', 'technology'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('instinct', {
        description: 'Gut reactions, urgency, danger detection, intuition',
        signals: [
            'urgent', 'asap', 'critical', 'danger', 'warning', 'careful',
            'wrong', 'suspicious', 'risk', 'security', 'vulnerability',
            'immediately', 'emergency', 'don\'t', 'stop', 'wait',
            'bad idea', 'risky',
        ],
        entityAffinity: ['service', 'file'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('emotional', {
        description: 'Emotional state awareness, frustration, excitement, mood',
        signals: [
            'frustrated', 'annoyed', 'excited', 'happy', 'confused',
            'stuck', 'tired', 'overwhelmed', 'celebrate', 'angry',
            'disappointed', 'amazing', 'awesome', 'hate this', 'ugh',
            'finally', 'yes!',
        ],
        entityAffinity: ['person'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('creative', {
        description: 'Brainstorming, ideation, exploration, what-if scenarios',
        signals: [
            'idea', 'brainstorm', 'what if', 'explore', 'imagine',
            'design', 'prototype', 'experiment', 'try', 'alternative',
            'inspiration', 'creative', 'innovate', 'rethink', 'reimagine',
        ],
        entityAffinity: ['concept', 'technology', 'project'],
        builtIn: true,
    });

    DOMAIN_REGISTRY.set('routine', {
        description: 'Habitual patterns, daily workflows, standard procedures',
        signals: [
            'usually', 'always', 'every time', 'habit', 'routine',
            'standard', 'typical', 'normal', 'default', 'workflow',
            'process', 'how i do', 'my way', 'convention',
        ],
        entityAffinity: ['technology', 'project', 'service'],
        builtIn: true,
    });
}

// Initialize on module load
registerBuiltIns();

// ── Situation Model ───────────────────────────────────

/** The computed situation model for a query — determines retrieval lens */
export interface SituationModel {
    /** Soft activation weights for each domain (0-1) */
    domains: Map<LifeDomain, number>;
    /** Inferred goal from recent context */
    goal: string;
    /** Entity names active in recent context */
    activeEntities: string[];
    /** Top 1-3 domains sorted by weight */
    primary: LifeDomain[];
}

/** Access context enriched with domain information */
export interface AccessContext {
    /** The original query intent */
    intent: string;
    /** Which domains were active during access */
    domains: LifeDomain[];
    /** Soft activation weights */
    weights: Partial<Record<string, number>>;
}

// ── Situation Classifier ──────────────────────────────

/**
 * Classify the current situation based on query + recent context.
 * Uses keyword signals + entity-type signals. No LLM call needed.
 *
 * @param query Current user query
 * @param recentMessages Last few messages for context
 * @param activeEntityTypes Entity types mentioned in recent context
 * @returns SituationModel with soft domain activations
 */
export function classifySituation(
    query: string,
    recentMessages: string[] = [],
    activeEntityTypes: EntityType[] = [],
): SituationModel {
    const weights = new Map<LifeDomain, number>();

    // Combine query + recent context into a single analysis string
    const contextWindow = [query, ...recentMessages.slice(0, 5)].join(' ').toLowerCase();
    const queryLower = query.toLowerCase();

    // Score each domain by signal matches
    for (const [domain, descriptor] of DOMAIN_REGISTRY) {
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
 */
function inferGoal(query: string, primaryDomains: LifeDomain[]): string {
    // Simple heuristic: first domain + cleaned query
    const domain = primaryDomains[0] ?? 'knowledge';
    const shortQuery = query.slice(0, 80).replace(/[?!.]+$/, '').trim();
    return `${domain}: ${shortQuery}`;
}

// ── Domain-Aware Re-ranking ───────────────────────────

/**
 * Get the domain affinity score for an entity type in the current situation.
 * Returns a multiplier (0.5 = suppress, 1.0 = neutral, 1.5 = boost).
 */
export function domainBoost(
    entityType: EntityType,
    situation: SituationModel,
): number {
    let maxAffinity = 0;

    for (const [domain, weight] of situation.domains) {
        const descriptor = DOMAIN_REGISTRY.get(domain);
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
 */
export function observationDomainBoost(
    observationContent: string,
    situation: SituationModel,
): number {
    const obsLower = observationContent.toLowerCase();
    let maxScore = 0;

    for (const [domain, weight] of situation.domains) {
        const descriptor = DOMAIN_REGISTRY.get(domain);
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

/**
 * Build an AccessContext from the current situation model.
 * This is stored on entities/chunks when they're accessed.
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

// ── Dynamic Domain Discovery ──────────────────────────

/**
 * Register a new domain discovered by the agent at runtime.
 * This allows the system to grow its understanding of life situations.
 *
 * @returns true if registered, false if domain already exists
 */
export function registerDomain(
    name: string,
    descriptor: Omit<DomainDescriptor, 'builtIn'>,
): boolean {
    const key = name.toLowerCase().trim().replace(/\s+/g, '_');
    if (DOMAIN_REGISTRY.has(key)) return false;

    DOMAIN_REGISTRY.set(key, {
        ...descriptor,
        builtIn: false,
    });
    return true;
}

/**
 * Get a domain descriptor by name (for introspection/debugging).
 */
export function getDomain(name: LifeDomain): DomainDescriptor | undefined {
    return DOMAIN_REGISTRY.get(name);
}

/**
 * List all registered domains (built-in + discovered).
 */
export function listDomains(): Array<{ name: LifeDomain; descriptor: DomainDescriptor }> {
    return Array.from(DOMAIN_REGISTRY.entries()).map(([name, descriptor]) => ({
        name,
        descriptor,
    }));
}

/**
 * Get count of registered domains.
 */
export function domainCount(): number {
    return DOMAIN_REGISTRY.size;
}

// ── Entity Type → Domain Affinity Table ───────────────

/**
 * Quick lookup: which domains naturally relate to an entity type?
 * Used by the re-ranker when it doesn't have observation-level signals.
 */
export const ENTITY_DOMAIN_AFFINITY: Record<EntityType, LifeDomain[]> = {
    person: ['identity', 'social', 'emotional'],
    project: ['planning', 'knowledge', 'environment'],
    technology: ['knowledge', 'capability', 'preference'],
    preference: ['preference', 'identity'],
    concept: ['knowledge', 'creative'],
    file: ['environment', 'knowledge'],
    service: ['environment', 'capability', 'instinct'],
    organization: ['identity', 'social'],
    'agent-self': ['identity', 'capability', 'knowledge', 'creative'],
    other: ['knowledge'],
};
