/**
 * Self-identity context — reading/writing agent's observations about itself.
 *
 * - getSelfContext(): builds categorized self-awareness for system prompts
 * - recordSelfObservation(): stores a new observation about self
 * - updateEntitySession(): writes rolling conversation context onto a person entity
 *
 * @module memory/manager/self-identity
 */

import type { GraphState } from '../knowledge-graph';
import {
    getSelfEntity,
    addSelfObservation,
    updateSessionContext,
    getAllRelations,
    SELF_ENTITY_NAME,
} from '../knowledge-graph';

/**
 * Get self-identity context — the agent's observations about itself,
 * categorized by tag prefix for system prompt injection.
 *
 * Categories:
 *   RULES (user-preference-about-me) — highest priority, always included
 *   MISTAKES — things to avoid
 *   IMPROVEMENTS — things to do more of
 *   IDENTITY — promoted observations (trait/belief/fact)
 *   RELATIONS — self-relations
 *
 * Filters noise (short extracted observations, XML leaks).
 * Caps output at 3000 chars.
 */
export function getSelfContext(graph: GraphState): string {
    const self = getSelfEntity(graph);
    if (self.observations.length === 0) return '';

    const CAP = 3000;
    const rules: string[] = [];
    const mistakes: string[] = [];
    const improvements: string[] = [];
    const identity: string[] = [];

    for (const obs of self.observations) {
        const c = obs.content;

        // Filter noise: short extracted observations and XML leaks
        if (obs.evidence.sources.includes('extracted') && c.length < 60) continue;
        if (c.includes('</') || c.includes('/>')) continue;

        // Categorize by tag prefix
        if (c.includes('[user-preference-about-me]')) {
            rules.push(c);
        } else if (c.includes('[mistake]')) {
            mistakes.push(c);
        } else if (c.includes('[improvement]')) {
            improvements.push(c);
        } else if (['trait', 'belief', 'fact'].includes(obs.stage)) {
            identity.push(c);
        }
    }

    const sections: string[] = [];
    if (rules.length > 0) sections.push('RULES (follow strictly):\n' + rules.map(r => `- ${r}`).join('\n'));
    if (mistakes.length > 0) sections.push('MISTAKES (never repeat):\n' + mistakes.map(m => `- ${m}`).join('\n'));
    if (improvements.length > 0) sections.push('IMPROVEMENTS:\n' + improvements.map(i => `- ${i}`).join('\n'));
    if (identity.length > 0) sections.push('IDENTITY:\n' + identity.map(i => `- ${i}`).join('\n'));

    // Include self-relations
    const selfRelations = getAllRelations(graph)
        .filter(r => r.from.toLowerCase() === SELF_ENTITY_NAME.toLowerCase()
            || r.to.toLowerCase() === SELF_ENTITY_NAME.toLowerCase());

    if (selfRelations.length > 0) {
        const relLines = selfRelations.map(r =>
            r.from.toLowerCase() === SELF_ENTITY_NAME.toLowerCase()
                ? `- I ${r.type} ${r.to}`
                : `- ${r.from} ${r.type} me`
        );
        sections.push('RELATIONS:\n' + relLines.join('\n'));
    }

    let result = sections.join('\n\n');
    if (result.length > CAP) result = result.slice(0, CAP) + '\n…(truncated)';
    return result;
}

/** Record an observation about the agent itself. */
export function recordSelfObservation(graph: GraphState, content: string, source: string = 'self-reflect'): void {
    addSelfObservation(graph, content, source);
}

/**
 * Update a person's entity with the latest conversation context.
 *
 * Creates a rolling "[Current Session]" observation reflecting recent
 * exchanges. Persists across restarts via the graph.
 */
export function updateEntitySession(
    graph: GraphState,
    entityName: string,
    exchanges: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>,
    channel?: string,
): void {
    if (!entityName || exchanges.length === 0) return;

    const lines: string[] = [];
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    lines.push(`(updated ${now}${channel ? `, via ${channel}` : ''}, ${exchanges.length} messages)`);

    for (const msg of exchanges.slice(-10)) {
        const prefix = msg.role === 'user' ? 'User' : 'Agent';
        const ts = msg.timestamp.toISOString().slice(11, 19);
        const preview = msg.content.slice(0, 200);
        lines.push(`[${ts}] ${prefix}: ${preview}${msg.content.length > 200 ? '…' : ''}`);
    }

    updateSessionContext(graph, entityName, lines.join('\n'));
}
