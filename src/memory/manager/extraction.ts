/**
 * Entity extraction — LLM-based and heuristic extraction for knowledge graph.
 *
 * - extractEntitiesAsync: fire-and-forget LLM extraction after each exchange
 * - extractFactToGraph: pattern-matching extraction for explicit save_knowledge calls
 *
 * @module memory/manager/extraction
 */

import type { GraphState, ExtractedEntities } from '../knowledge-graph';
import {
    addEntity,
    addRelation,
    mergeExtracted,
    buildExtractionPrompt,
} from '../knowledge-graph';

/**
 * Extract entities from a conversation exchange using LLM.
 * Runs async (fire-and-forget) so it doesn't block streaming.
 */
export function extractEntitiesAsync(
    graph: GraphState,
    entityExtractor: ((prompt: string) => Promise<string>) | undefined,
    userMessage: string,
    assistantMessage: string,
): void {
    if (!entityExtractor) return;

    // Skip trivial exchanges
    if (userMessage.length < 20 && assistantMessage.length < 50) return;

    const prompt = buildExtractionPrompt(userMessage, assistantMessage);

    entityExtractor(prompt)
        .then(jsonStr => {
            try {
                const cleaned = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
                const extracted: ExtractedEntities = JSON.parse(cleaned);

                if (extracted.entities.length > 0 || extracted.relations.length > 0) {
                    const { newEntities, newRelations } = mergeExtracted(graph, extracted);
                    if (newEntities > 0 || newRelations > 0) {
                        console.log(`🔗 Graph updated: +${newEntities} entities, +${newRelations} relations`);
                    }
                }
            } catch {
                // JSON parse failed — ignore silently
            }
        })
        .catch(() => {
            // Extraction error — non-critical, ignore
        });
}

/**
 * Simple heuristic extraction for explicit save_knowledge calls.
 * No LLM needed — pattern matching for common fact formats:
 *   - "User prefers X over Y"
 *   - "Project uses X"
 *   - "X is Y"
 *   - Fallback: create entity from category
 */
export function extractFactToGraph(graph: GraphState, fact: string, category?: string): void {
    // Pattern: "User prefers X over Y"
    const prefersMatch = fact.match(/(?:user|i)\s+prefers?\s+(.+?)\s+(?:over|instead of|rather than)\s+(.+)/i);
    if (prefersMatch) {
        addEntity(graph, prefersMatch[1].trim(), 'preference', [fact]);
        addEntity(graph, prefersMatch[2].trim(), 'technology', [`Not preferred: ${fact}`]);
        addRelation(graph, prefersMatch[1].trim(), prefersMatch[2].trim(), 'preferred_over');
        return;
    }

    // Pattern: "Project uses X"
    const usesMatch = fact.match(/(?:project|app|system|codebase)\s+uses?\s+(.+)/i);
    if (usesMatch) {
        const tech = usesMatch[1].replace(/[.!]+$/, '').trim();
        addEntity(graph, tech, 'technology', [fact]);
        return;
    }

    // Pattern: "X is Y" — generic entity creation
    const isMatch = fact.match(/^(.{2,30})\s+(?:is|are)\s+(.+)/i);
    if (isMatch) {
        const entityType = category === 'user-preference' ? 'preference'
            : category === 'project-context' ? 'project'
                : category === 'technical-note' ? 'technology'
                    : 'other';
        addEntity(graph, isMatch[1].trim(), entityType as any, [fact]);
        return;
    }

    // Fallback: create entity from category
    if (category) {
        const entityType = category === 'user-preference' ? 'preference'
            : category === 'project-context' ? 'project'
                : category === 'technical-note' ? 'technology'
                    : 'other';
        const name = fact.split(/[,.:;!?]/)[0].trim().slice(0, 50);
        if (name.length > 3) {
            addEntity(graph, name, entityType as any, [fact]);
        }
    }
}
