/**
 * Tool Auto-Loader — discovers and registers everything from the tools directory.
 *
 * Three conventions, all auto-discovered:
 *
 *   1. Static tools:  `export const xxx = tool({...})`
 *      → registered as snake_case(xxx), no deps needed
 *
 *   2. Factory tools:  `export function register(deps: ToolDeps): Record<string, any>`
 *      → called with ToolDeps at startup, returned tools merged into toolSet
 *
 *   3. MCP declarations:  `export const mcpServer: McpDeclaration = {...}` (in *.mcp.ts)
 *      → connected during agent init, tools bridged into toolSet
 *
 * To add a new tool: create a file in src/tools/, export one of the above. Done.
 *
 * @module tools/auto-loader
 */

import { readdirSync } from 'fs';
import { join } from 'path';
import type { ToolDeps, McpDeclaration } from './deps';

/** Files that are utilities/infrastructure, not tool definitions */
const SKIP_FILES = new Set([
    'access.ts', 'access.js',
    'ai-tools.ts', 'ai-tools.js',          // legacy barrel re-export (deleted, dist/ artifact)
    'auto-loader.ts', 'auto-loader.js',
    'deps.ts', 'deps.js',
    'error-enhancer.ts', 'error-enhancer.js',
    'memory-tools.ts', 'memory-tools.js',   // legacy (deleted, dist/ artifact)
    'registry.ts', 'registry.js',           // legacy (deleted, dist/ artifact)
    'tool-index.ts', 'tool-index.js',       // Tool RAG index — not a tool file
]);

/** Result of scanning the tools directory */
export interface DiscoveryResult {
    /** Ready-to-use static tool definitions (tool_name → toolDef) */
    staticTools: Record<string, any>;
    /** Factory functions that need ToolDeps — call with deps to get tools */
    factories: Array<{ file: string; register: (deps: ToolDeps) => Record<string, any> }>;
    /** MCP server declarations to connect during init */
    mcpServers: McpDeclaration[];
}

/**
 * Detect whether a JS value is a Vercel AI SDK tool definition.
 * Tools created with `tool()` have these properties.
 */
function isToolDefinition(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, any>;
    return (
        typeof obj.description === 'string' &&
        (typeof obj.execute === 'function' || obj.inputSchema != null)
    );
}

/**
 * Detect whether a JS value is an MCP server declaration.
 */
function isMcpDeclaration(value: unknown): value is McpDeclaration {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, any>;
    return typeof obj.name === 'string' && (typeof obj.url === 'string' || typeof obj.command === 'string');
}

/** Convert camelCase export name to snake_case tool name */
function camelToSnake(str: string): string {
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();
}

/**
 * Scan the tools directory and discover all three categories.
 *
 * Uses require() for synchronous loading (project is CommonJS).
 */
export function discoverAllTools(): DiscoveryResult {
    const toolsDir = __dirname; // auto-loader lives in src/tools/
    const result: DiscoveryResult = { staticTools: {}, factories: [], mcpServers: [] };

    const files = readdirSync(toolsDir).filter(f => {
        if (f.startsWith('_')) return false;
        if (SKIP_FILES.has(f)) return false;
        if (!f.endsWith('.ts') && !f.endsWith('.js')) return false;
        if (f.endsWith('.d.ts') || f.endsWith('.d.ts.map')) return false; // skip type declarations
        if (f.endsWith('.js.map')) return false;                          // skip source maps
        if (f.includes('.test.') || f.includes('.spec.')) return false;
        return true;
    });

    for (const file of files) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(join(toolsDir, file));

            // 1. MCP declarations (*.mcp.ts files export mcpServer or mcpServers)
            if (mod.mcpServer && isMcpDeclaration(mod.mcpServer)) {
                result.mcpServers.push(mod.mcpServer);
            }
            if (Array.isArray(mod.mcpServers)) {
                for (const s of mod.mcpServers) {
                    if (isMcpDeclaration(s)) result.mcpServers.push(s);
                }
            }

            // 2. Factory tools (export function register(deps))
            if (typeof mod.register === 'function') {
                result.factories.push({ file, register: mod.register });
            }

            // 3. Static tools (export const xxx = tool({...}))
            for (const [exportName, value] of Object.entries(mod)) {
                if (!isToolDefinition(value)) continue;

                const toolName = camelToSnake(exportName);
                if (result.staticTools[toolName]) {
                    console.warn(`[Auto-Loader]: Duplicate tool "${toolName}" from ${file} — skipping`);
                    continue;
                }
                result.staticTools[toolName] = value;
            }
        } catch (err) {
            console.error(`[Auto-Loader]: Failed to load ${file}:`, err instanceof Error ? err.message : err);
        }
    }

    const s = Object.keys(result.staticTools).length;
    const f = result.factories.length;
    const m = result.mcpServers.length;
    console.log(`[Auto-Loader]: Discovered ${s} static tools, ${f} factories, ${m} MCP servers from ${files.length} files`);
    return result;
}

/**
 * Convenience wrapper — discovers static tools only (backward compat).
 */
export function discoverTools(): Record<string, any> {
    return discoverAllTools().staticTools;
}
