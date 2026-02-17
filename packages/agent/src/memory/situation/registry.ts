/**
 * Domain registry — mutable store of domain descriptors with CRUD operations.
 *
 * Manages the registry of life domains (built-in + dynamically discovered).
 * The registry is populated with 12 built-in domains on module load and can
 * be extended at runtime via `registerDomain()`.
 *
 * @module situation/registry
 */

import type { DomainDescriptor, LifeDomain } from './types';

// ── Internal Registry ─────────────────────────────────

/** The domain registry — extensible at runtime. */
const DOMAIN_REGISTRY = new Map<LifeDomain, DomainDescriptor>();

/**
 * Get the internal domain registry Map.
 * Exported for read access by the classifier and boost modules.
 *
 * @returns The live `Map<LifeDomain, DomainDescriptor>` (not a copy)
 */
export function getDomainRegistry(): ReadonlyMap<LifeDomain, DomainDescriptor> {
    return DOMAIN_REGISTRY;
}

// ── Built-in Registration ─────────────────────────────

/** Populate the registry with the 12 universal life domains. */
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

// ── Public API ────────────────────────────────────────

/**
 * Register a new domain discovered by the agent at runtime.
 * Allows the system to grow its understanding of life situations.
 *
 * @param name       - Domain name (lowercased/snake_cased internally)
 * @param descriptor - Domain metadata (description, signals, entity affinity)
 * @returns `true` if registered, `false` if domain already exists
 *
 * @example
 * ```ts
 * registerDomain('financial', {
 *   description: 'Budget, spending, money decisions',
 *   signals: ['cost', 'price', 'budget', 'spend'],
 *   entityAffinity: ['service', 'project'],
 * });
 * ```
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
 * Get a domain descriptor by name.
 *
 * @param name - Domain name to look up
 * @returns The descriptor, or `undefined` if not registered
 */
export function getDomain(name: LifeDomain): DomainDescriptor | undefined {
    return DOMAIN_REGISTRY.get(name);
}

/**
 * List all registered domains (built-in + discovered).
 *
 * @returns Array of `{ name, descriptor }` pairs
 */
export function listDomains(): Array<{ name: LifeDomain; descriptor: DomainDescriptor }> {
    return Array.from(DOMAIN_REGISTRY.entries()).map(([name, descriptor]) => ({
        name,
        descriptor,
    }));
}

/**
 * Get count of registered domains.
 *
 * @returns Number of domains currently in the registry
 */
export function domainCount(): number {
    return DOMAIN_REGISTRY.size;
}
