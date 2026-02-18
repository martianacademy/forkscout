/**
 * Context builder — assembles the optimized context string for the LLM.
 *
 * Combines recent sliding window + knowledge graph facts + vector store
 * memories + skill store hits. All capped to a configurable token budget.
 *
 * @module memory/manager/context-builder
 */

import type { VectorStore } from '../vector-store';
import type { GraphState } from '../knowledge-graph';
import {
    searchGraph,
    formatForContext,
} from '../knowledge-graph';
import type { SkillStore } from '../skills';
import {
    classifySituation, domainBoost, observationDomainBoost,
    buildAccessContext, type LifeDomain,
} from '../situation';
import { countTokens } from '../../utils/tokens';
import type { MemoryConfig, RecentMessage } from './types';

// ── Result shape ───────────────────────────────────────

export interface ContextResult {
    recentHistory: string;
    relevantMemories: string;
    graphContext: string;
    skillContext: string;
    stats: {
        recentCount: number;
        retrievedCount: number;
        graphEntities: number;
        totalChunks: number;
        skillCount: number;
        situation: { primary: LifeDomain[]; goal: string };
    };
}

// ── Build context ──────────────────────────────────────

/**
 * Build an optimized context string for the LLM.
 *
 * Order of priority:
 *   1. Recent sliding window (always included)
 *   2. Knowledge graph facts (deterministic entity lookup, domain-ranked)
 *   3. Relevant old memories from vector store (fuzzy, query-expanded)
 *   4. Skill store hits (procedural memory)
 */
export async function buildContext(
    currentQuery: string,
    config: MemoryConfig,
    recentMessages: RecentMessage[],
    graph: GraphState,
    vectorStore: VectorStore,
    skills: SkillStore,
    sessionId: string,
): Promise<ContextResult> {
    const budgetTokens = config.contextBudget ?? 4000;
    let remainingTokens = budgetTokens;
    const recentWindowSize = config.recentWindowSize ?? 6;
    const relevantMemoryLimit = config.relevantMemoryLimit ?? 5;

    // 0. Classify the current situation (domain lens)
    const recent = recentMessages
        .slice(-recentWindowSize)
        .map(({ role, content }) => ({ role, content }));
    const recentTexts = recent.map(r => r.content);

    // Gather active entity types from recent graph hits
    const preflightHits = searchGraph(graph, currentQuery, 3);
    const activeEntityTypes = preflightHits.map(h => h.entity.type);

    const situation = classifySituation(currentQuery, recentTexts, activeEntityTypes);
    const accessCtx = buildAccessContext(currentQuery, situation);

    // 1. Recent sliding window (always included, highest priority)
    const recentStr = recent
        .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
        .join('\n');
    remainingTokens -= countTokens(recentStr);

    // 2. Knowledge graph lookup with domain-aware re-ranking
    let graphStr = '';
    let graphEntities = 0;
    if (remainingTokens > 50) {
        const graphBudgetTokens = Math.min(Math.floor(remainingTokens * 0.4), 600);
        const graphBudgetChars = graphBudgetTokens * 4;
        const graphResults = searchGraph(graph, currentQuery, 8);

        if (graphResults.length > 0) {
            for (const result of graphResults) {
                const entityBoost = domainBoost(result.entity.type, situation);

                let obsBoostSum = 0;
                for (const obs of result.entity.observations) {
                    obsBoostSum += observationDomainBoost(obs.content, situation);
                }
                const avgObsBoost = result.entity.observations.length > 0
                    ? obsBoostSum / result.entity.observations.length
                    : 1.0;

                result.score *= entityBoost * avgObsBoost;
                result.entity.lastAccessContext = accessCtx;
            }

            graphResults.sort((a, b) => b.score - a.score);
            const topResults = graphResults.slice(0, 5);

            graphStr = '\n\n' + formatForContext(topResults, graphBudgetChars);
            graphEntities = topResults.length;
            remainingTokens -= countTokens(graphStr);
        }
    }

    // 3. Vector store search with query expansion (fuzzy — fills remaining budget)
    let relevantStr = '';
    let retrievedCount = 0;
    if (remainingTokens > 50) {
        const expandedQuery = expandQuery(currentQuery);
        const results = await vectorStore.search(expandedQuery, relevantMemoryLimit, sessionId);
        const filtered: string[] = [];

        for (const mem of results) {
            const isInRecent = recent.some(r =>
                mem.text.includes(r.content.slice(0, 50))
            );
            if (isInRecent) continue;

            const entry = `[Memory (${(mem.score * 100).toFixed(0)}%)]: ${mem.text}`;
            const entryTokens = countTokens(entry);
            if (remainingTokens - entryTokens < 0) break;
            filtered.push(entry);
            remainingTokens -= entryTokens;
            retrievedCount++;
        }

        if (filtered.length > 0) {
            relevantStr = '\n\nRelevant memories from past conversations:\n' + filtered.join('\n');
        }
    }

    // 4. Skill store lookup (procedural memory)
    let skillStr = '';
    let skillCount = 0;
    if (remainingTokens > 50) {
        const relevantSkills = skills.findByIntent(currentQuery, 3);
        if (relevantSkills.length > 0) {
            const skillBudgetChars = Math.min(remainingTokens * 4, 1000);
            skillStr = '\n\n' + skills.formatForContext(relevantSkills, skillBudgetChars);
            skillCount = relevantSkills.length;
            remainingTokens -= countTokens(skillStr);
        }
    }

    return {
        recentHistory: recentStr,
        relevantMemories: relevantStr,
        graphContext: graphStr,
        skillContext: skillStr,
        stats: {
            recentCount: recent.length,
            retrievedCount,
            graphEntities,
            totalChunks: vectorStore.size,
            skillCount,
            situation: {
                primary: situation.primary,
                goal: situation.goal,
            },
        },
    };
}

// ── Query expansion (inline helper) ────────────────────

/**
 * Expand a query with additional search terms for better vector recall.
 * Extracts PascalCase tech terms and quoted phrases.
 */
export function expandQuery(query: string): string {
    if (query.split(/\s+/).length <= 5) return query;

    const techTerms = query.match(/\b[A-Z][a-zA-Z]+(?:\.[a-zA-Z]+)*\b/g) || [];
    const quotedTerms = query.match(/"([^"]+)"/g)?.map(t => t.replace(/"/g, '')) || [];

    const extras = [...new Set([...techTerms, ...quotedTerms])].slice(0, 5);
    if (extras.length === 0) return query;

    return `${query} ${extras.join(' ')}`;
}
