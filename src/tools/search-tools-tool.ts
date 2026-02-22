/**
 * Search Tools — meta-tool for the LLM to discover available tools on-demand.
 *
 * Part of the Tool RAG system. Instead of loading all 50+ tool definitions
 * into every request (~8-11K tokens), the LLM uses this lightweight tool
 * to search the in-memory tool index and discover what's available.
 *
 * Zero-cost: no LLM call, no external request — just an in-memory lookup.
 *
 * @module tools/search-tools-tool
 */

import { tool } from 'ai';
import { z } from 'zod';
import { withAccess } from './access';
import {
    searchTools,
    formatSearchResults,
    formatCategorySummary,
    getToolsByCategory,
    getIndexSize,
} from './tool-index';

export const searchAvailableTools = withAccess('guest', tool({
    description:
        'Search for available tools by keyword or category. Use this BEFORE attempting to call a tool you haven\'t used yet. ' +
        'Returns matching tools with descriptions and parameters. ' +
        'Examples: "file operations", "telegram", "web search", "voice", "memory", "mcp". ' +
        'Pass mode "categories" to see all tool categories and counts.',
    inputSchema: z.object({
        query: z.string().describe(
            'What you need to do — describe the capability you\'re looking for. ' +
            'Examples: "read a file", "send telegram message", "search the web", "manage secrets"',
        ),
        mode: z.enum(['search', 'categories']).default('search').describe(
            'search = find tools matching query (default). categories = list all tool categories.',
        ),
        limit: z.number().min(1).max(20).default(8).describe(
            'Max results to return (default 8).',
        ),
    }),
    execute: async ({ query, mode, limit }) => {
        const indexSize = getIndexSize();
        if (indexSize === 0) {
            return 'Tool index not built yet — all tools are available in the current toolSet.';
        }

        if (mode === 'categories') {
            return `Tool categories (${indexSize} tools indexed):\n${formatCategorySummary()}`;
        }

        // Search mode
        const results = searchTools(query, limit);
        if (results.length === 0) {
            // Try category fallback — maybe the query IS a category name
            const categoryTools = getToolsByCategory(query.toLowerCase());
            if (categoryTools.length > 0) {
                const formatted = categoryTools.slice(0, limit).map(t =>
                    `• ${t.name}: ${t.description.slice(0, 150)}`,
                ).join('\n');
                return `Tools in "${query}" category:\n${formatted}`;
            }
            return `No tools found for "${query}". Try "categories" mode to see what's available.`;
        }

        return formatSearchResults(results);
    },
}));
