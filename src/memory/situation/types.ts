/**
 * Situation types — pure type definitions and constants for the domain system.
 *
 * Defines the life-domain vocabulary used by the situation classifier.
 * Domains are retrieval lenses, not storage labels — the same memory surfaces
 * differently depending on the active situation.
 *
 * @module situation/types
 */

import type { EntityType } from '../knowledge-graph';

// ── Life Domain Types ─────────────────────────────────

/**
 * Built-in life domains — the universal situations a mind encounters.
 *
 * Each domain represents a *why* lens for memory retrieval:
 * - `identity`    — who/relationship ("who is this person?")
 * - `preference`  — likes/dislikes ("what do they like?")
 * - `capability`  — skills/ability ("can they fix this?")
 * - `knowledge`   — factual info ("what is Rust?")
 * - `planning`    — deciding actions ("what should we do?")
 * - `episodic`    — past events ("what happened earlier?")
 * - `social`      — interaction tone ("how should I respond?")
 * - `environment` — current situation ("what changed?")
 * - `instinct`    — gut/urgency ("something feels wrong")
 * - `emotional`   — emotional state ("user seems frustrated")
 * - `creative`    — brainstorming ("let's explore ideas")
 * - `routine`     — habitual patterns ("how do I usually do this?")
 */
export const BUILT_IN_DOMAINS = [
    'identity',
    'preference',
    'capability',
    'knowledge',
    'planning',
    'episodic',
    'social',
    'environment',
    'instinct',
    'emotional',
    'creative',
    'routine',
] as const;

/** One of the 12 built-in life domains. */
export type BuiltInDomain = typeof BUILT_IN_DOMAINS[number];

/** A life domain — either built-in or dynamically discovered at runtime. */
export type LifeDomain = BuiltInDomain | string;

// ── Domain Descriptor ─────────────────────────────────

/** Description and signal patterns for a domain. */
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

// ── Situation Model ───────────────────────────────────

/** The computed situation model for a query — determines retrieval lens. */
export interface SituationModel {
    /** Soft activation weights for each domain (0–1) */
    domains: Map<LifeDomain, number>;
    /** Inferred goal from recent context */
    goal: string;
    /** Entity names active in recent context */
    activeEntities: string[];
    /** Top 1–3 domains sorted by weight */
    primary: LifeDomain[];
}

/** Access context enriched with domain information. */
export interface AccessContext {
    /** The original query intent */
    intent: string;
    /** Which domains were active during access */
    domains: LifeDomain[];
    /** Soft activation weights */
    weights: Partial<Record<string, number>>;
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
