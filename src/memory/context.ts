/**
 * Memory context builder — assembles optimized context for the LLM.
 * @module memory/context
 */

import type { ContextResult, SearchResult } from './types';
import type { MemoryStore } from './store';

interface RecentMsg { role: 'user' | 'assistant'; content: string; timestamp: Date }

/** Build context from memory for injection into the system prompt. */
export function buildContext(
    query: string,
    store: MemoryStore,
    recentMessages: RecentMsg[],
    sessionId: string,
    budgetChars = 16000,
): ContextResult {
    let remaining = budgetChars;

    // 1. Recent sliding window (always included)
    const recentStr = recentMessages
        .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
        .join('\n');
    remaining -= recentStr.length;

    // 2. Knowledge graph entities
    let graphContext = '';
    let graphEntities = 0;
    if (remaining > 200) {
        const hits = store.searchEntities(query, 5);
        if (hits.length) {
            const lines: string[] = [];
            for (const e of hits) {
                const facts = e.facts.slice(0, 5).join('; ');
                const line = `• ${e.name} (${e.type}): ${facts}`;
                if (remaining - line.length < 0) break;
                lines.push(line);
                remaining -= line.length;
                graphEntities++;
            }
            if (lines.length) graphContext = '\n\n[Knowledge Graph]\n' + lines.join('\n');
        }
    }

    // 3. Relevant past exchanges (from older sessions)
    let relevantMemories = '';
    let retrievedCount = 0;
    if (remaining > 200) {
        const exchanges = store.searchExchanges(query, 5, sessionId);
        const lines: string[] = [];
        for (const ex of exchanges) {
            const line = `[Past] User: ${ex.user.slice(0, 200)}\nAssistant: ${ex.assistant.slice(0, 200)}`;
            if (remaining - line.length < 0) break;
            lines.push(line);
            remaining -= line.length;
            retrievedCount++;
        }
        if (lines.length) relevantMemories = '\n\nRelevant memories from past conversations:\n' + lines.join('\n\n');
    }

    return {
        recentHistory: recentStr,
        relevantMemories,
        graphContext,
        skillContext: '', // skills are now just entity facts tagged [skill]
        stats: {
            recentCount: recentMessages.length,
            retrievedCount,
            graphEntities,
            totalChunks: store.exchangeCount,
            skillCount: 0,
            situation: { primary: [], goal: '' },
        },
    };
}

/** Search across both entities and exchanges (unified). */
export function searchKnowledge(store: MemoryStore, query: string, limit = 5): SearchResult[] {
    const results: SearchResult[] = [];

    const entities = store.searchEntities(query, limit);
    for (const e of entities) {
        const facts = e.facts.slice(0, 5).join('; ');
        results.push({ content: `${e.name} (${e.type}): ${facts}`, source: 'graph', relevance: 90 });
    }

    const exchanges = store.searchExchanges(query, limit);
    for (const ex of exchanges) {
        results.push({
            content: `User: ${ex.user.slice(0, 200)} → Assistant: ${ex.assistant.slice(0, 200)}`,
            source: 'exchange',
            relevance: 70,
        });
    }

    return results.slice(0, limit);
}

/** Build a failure observation string from a reasoning context + response. */
export function buildFailureObservation(
    ctx: { toolFailures: Array<{ toolName: string; error: string }>; userMessage: string },
    finalText: string,
): string | null {
    if (!ctx.toolFailures || ctx.toolFailures.length === 0) return null;
    const resolved = finalText.length > 50;
    const failures = ctx.toolFailures.slice(0, 5).map(f => `${f.toolName}: ${f.error.slice(0, 100)}`).join('; ');
    return resolved
        ? `[FAILURE→RESOLVED] "${ctx.userMessage.slice(0, 100)}": ${failures}. Fix: ${finalText.slice(0, 150)}`
        : `[FAILURE→UNRESOLVED] "${ctx.userMessage.slice(0, 100)}": ${failures}`;
}
