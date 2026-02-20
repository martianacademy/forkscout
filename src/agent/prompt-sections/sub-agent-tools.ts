/**
 * Prompt section: Sub-Agent Tools
 * Dynamic tool guidance based on what's available to the sub-agent.
 *
 * @module agent/prompt-sections/sub-agent-tools
 */

import type { SubAgentContext } from './types';

export const order = 4;

export function subAgentToolsSection(ctx: SubAgentContext): string {
    const { toolNames, builtinToolNames } = ctx;
    const hasWebSearch = toolNames.includes('web_search');
    const hasBrowse = toolNames.includes('browse_web');
    const hasReadFile = toolNames.includes('read_file');
    const hasRunCommand = toolNames.includes('run_command');

    // Memory — split into read vs write capabilities
    const memTools = toolNames.filter(t => t.startsWith('forkscout-mem_'));
    const hasMemoryRead = memTools.some(t => /^forkscout-mem_(search_|get_|check_|memory_stats)/.test(t));
    const hasMemoryWrite = memTools.some(t => /^forkscout-mem_(add_|save_|update_|remove_|start_task|complete_task|abort_task|self_observe|consolidate)/.test(t));

    // File mutation
    const hasFileWrite = toolNames.includes('write_file') || toolNames.includes('append_file');
    const hasFileDelete = toolNames.includes('delete_file');

    // MCP tools — anything not in the built-in set and not forkscout-mem_*
    const KNOWN_BUILTINS = builtinToolNames ?? new Set<string>();
    const mcpToolNames = toolNames.filter(t => !KNOWN_BUILTINS.has(t) && !t.startsWith('forkscout-mem_'));
    const hasMcpTools = mcpToolNames.length > 0;

    const lines: string[] = [
        '## Tools',
        `You have access to: ${toolNames.join(', ')}`,
        'Call multiple tools in parallel when they are independent of each other.',
    ];

    if (hasWebSearch && hasBrowse) {
        lines.push(
            'For research tasks: Start with `web_search` to find relevant sources, then `browse_web` to extract details from the best results.',
            'Cross-reference multiple sources when accuracy matters. Don\'t rely on a single search result.',
        );
    } else if (hasWebSearch) {
        lines.push('Use `web_search` for web research. Refine queries if initial results are not relevant.');
    }

    if (hasReadFile) {
        lines.push(
            'Read large file sections at once rather than many small reads.',
            'If you need multiple file sections, read them in parallel.',
        );
    }

    if (hasRunCommand) {
        lines.push(
            'Use `run_command` for shell operations. Run one command at a time and wait for output.',
            'Prefer targeted commands (grep, find, head/tail) over reading entire files via shell.',
        );
    }

    if (hasMemoryRead && hasMemoryWrite) {
        lines.push(
            'You have FULL access to the knowledge graph (read + write).',
            'READ: Use `forkscout-mem_search_*` and `forkscout-mem_get_*` to retrieve stored knowledge. Check memory BEFORE searching the web.',
            'WRITE: Use `forkscout-mem_save_knowledge` for reusable patterns and insights. Use `forkscout-mem_add_entity` for new entities with facts. Use `forkscout-mem_add_exchange` to record problem→solution pairs.',
            'CORRECT: Use `forkscout-mem_update_entity` to replace wrong facts, or `forkscout-mem_remove_fact` to supersede them. Old facts are kept as history for learning. Use `forkscout-mem_get_fact_history` to see how beliefs evolved.',
            'Always `forkscout-mem_search_entities` before creating new entities to avoid duplicates.',
        );
    } else if (hasMemoryRead) {
        lines.push(
            'You have READ access to the knowledge graph. Use `forkscout-mem_search_*` and `forkscout-mem_get_*` to retrieve stored knowledge.',
            'Check memory BEFORE searching the web — the answer may already be stored.',
        );
    }

    if (hasFileWrite || hasFileDelete) {
        const ops = [hasFileWrite && 'write', hasFileDelete && 'delete'].filter(Boolean).join('/');
        lines.push(
            `You have ${ops.toUpperCase()} access to the filesystem. Make changes minimal, focused, and correct.`,
            'Before writing: read the existing file to understand context. After writing: verify the change (read back, compile check, etc.).',
            'Never overwrite entire files when you can make targeted edits.',
        );
    }

    if (hasMcpTools) {
        lines.push(
            `You have access to external MCP tools: ${mcpToolNames.join(', ')}`,
            'These tools connect to external services (documentation lookup, structured thinking, deep analysis).',
            'Use them when your task benefits from specialized domain knowledge or structured reasoning.',
        );
    }

    return lines.join('\n');
}
