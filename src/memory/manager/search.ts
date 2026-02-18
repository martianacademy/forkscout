/**
 * Knowledge search — unified search across vector store + knowledge graph.
 *
 * @module memory/manager/search
 */

import type { VectorStore } from '../vector-store';
import type { GraphState } from '../knowledge-graph';
import { searchGraph } from '../knowledge-graph';

export interface SearchResult {
    content: string;
    relevance: number;
    source: 'vector' | 'graph';
}

/**
 * Search knowledge and conversation history.
 * Searches BOTH vector store and knowledge graph, merges results.
 * Graph results listed first (deterministic, high confidence).
 */
export async function searchKnowledge(
    vectorStore: VectorStore,
    graph: GraphState,
    query: string,
    limit = 5,
): Promise<SearchResult[]> {
    const [vectorResults, graphResults] = await Promise.all([
        vectorStore.search(query, limit),
        Promise.resolve(searchGraph(graph, query, limit)),
    ]);

    const results: SearchResult[] = [];

    // Graph results first (deterministic, high confidence)
    for (const gr of graphResults) {
        const observations = gr.entity.observations.join('; ');
        const connections = gr.neighbors.slice(0, 3).map(n =>
            `${n.direction === 'outgoing' ? '→' : '←'} ${n.relation.type} ${n.entity.name}`
        ).join(', ');
        const content = `[${gr.entity.type}] ${gr.entity.name}: ${observations}${connections ? ` (${connections})` : ''}`;
        results.push({ content, relevance: Math.round(gr.score * 100), source: 'graph' });
    }

    // Vector results (fuzzy, scored)
    for (const vr of vectorResults) {
        const alreadyCovered = results.some(r =>
            r.source === 'graph' && vr.text.toLowerCase().includes(r.content.split(':')[1]?.trim().slice(0, 30).toLowerCase() || '__none__')
        );
        if (alreadyCovered) continue;

        results.push({
            content: vr.text,
            relevance: Math.round(vr.score * 100),
            source: 'vector',
        });
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
}
