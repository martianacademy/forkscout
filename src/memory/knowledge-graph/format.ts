/**
 * Format for context — render graph search results as LLM-readable text.
 *
 * Produces a compact string showing entities, their observations (sorted
 * by stage weight), and top neighbour relations, all within a character budget.
 *
 * @module knowledge-graph/format
 */

import type { GraphSearchResult } from './types';
import { STAGE_WEIGHTS } from './types';

/**
 * Format graph search results as a readable string for the LLM context.
 *
 * Shows observation content with `[stage]` tags for promoted observations.
 * Respects a character budget to avoid blowing up the context window.
 *
 * @param results  - Search results to format
 * @param maxChars - Character budget (default 2000)
 * @returns Formatted string for LLM system prompt injection
 *
 * @example
 * ```ts
 * const results = searchGraph(state, 'TypeScript');
 * const text = formatForContext(results, 2000);
 * // "[Knowledge Graph]\n• TypeScript (technology)\n  - Preferred language\n  → uses → React"
 * ```
 */
export function formatForContext(results: GraphSearchResult[], maxChars = 2000): string {
    if (results.length === 0) return '';

    const lines: string[] = ['[Knowledge Graph]'];
    let charCount = lines[0].length;

    for (const { entity, neighbors } of results) {
        const header = `• ${entity.name} (${entity.type})`;
        if (charCount + header.length > maxChars) break;
        lines.push(header);
        charCount += header.length;

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
