/**
 * Plugin Loader — dynamically loads tools and prompts from `custom/` at runtime.
 *
 * This lets the agent extend itself without editing source code (src/).
 * No rebuild or restart needed — just write a .js file and call reload_plugins.
 *
 * Plugin structure:
 *   custom/
 *     tools/         ← JS files exporting AI SDK tool() objects
 *     prompts/       ← .md files appended to system prompt
 *
 * Tool plugin format (custom/tools/my-tool.js):
 *   import { tool } from 'ai';
 *   import { z } from 'zod';
 *   export const my_tool = tool({
 *       description: '...',
 *       inputSchema: z.object({ ... }),
 *       execute: async (params) => { ... },
 *   });
 *
 * Multiple tools can be exported from a single file.
 * Tool names are the export names (snake_case recommended).
 *
 * @module plugins/loader
 */

import { readdir, readFile, mkdir } from 'fs/promises';
import { resolve, join, extname } from 'path';
import { pathToFileURL } from 'url';
import { AGENT_ROOT } from '../paths';

const CUSTOM_DIR = resolve(AGENT_ROOT, 'custom');
const TOOLS_DIR = resolve(CUSTOM_DIR, 'tools');
const PROMPTS_DIR = resolve(CUSTOM_DIR, 'prompts');

/** Loaded plugin tools: name → tool() instance */
export interface PluginState {
    /** tool name → AI SDK tool instance */
    tools: Record<string, any>;
    /** Loaded tool names grouped by source file */
    toolsByFile: Map<string, string[]>;
    /** Concatenated prompt fragments from custom/prompts/*.md */
    promptFragments: string;
    /** Number of prompt files loaded */
    promptFileCount: number;
    /** Errors encountered during loading */
    errors: string[];
}

/**
 * Ensure the custom/tools/ and custom/prompts/ directories exist.
 */
export async function ensurePluginDirs(): Promise<void> {
    await mkdir(TOOLS_DIR, { recursive: true });
    await mkdir(PROMPTS_DIR, { recursive: true });
}

/**
 * Load all tool plugins from custom/tools/.
 *
 * Supports .js, .mjs, and .ts files (tsx handles TS at runtime).
 * Each file is dynamically imported. All named exports that look like
 * AI SDK tool() objects (have `description` and `execute`) are collected.
 *
 * Uses cache-busting query strings so re-importing picks up changes.
 */
async function loadToolPlugins(): Promise<{
    tools: Record<string, any>;
    toolsByFile: Map<string, string[]>;
    errors: string[];
}> {
    const tools: Record<string, any> = {};
    const toolsByFile = new Map<string, string[]>();
    const errors: string[] = [];

    let files: string[];
    try {
        files = await readdir(TOOLS_DIR);
    } catch {
        return { tools, toolsByFile, errors }; // dir doesn't exist yet
    }

    const validExts = new Set(['.js', '.mjs', '.ts']);

    for (const file of files.sort()) {
        const ext = extname(file);
        if (!validExts.has(ext)) continue;
        if (file.startsWith('.') || file.startsWith('_')) continue; // skip hidden/private files

        const filePath = join(TOOLS_DIR, file);
        try {
            // Cache-bust so re-import picks up changes
            const url = pathToFileURL(filePath).href + `?t=${Date.now()}`;
            const mod = await import(url);

            const fileTools: string[] = [];
            for (const [name, val] of Object.entries(mod)) {
                if (name === 'default') continue; // skip default exports
                // Duck-type check: looks like an AI SDK tool?
                if (val && typeof val === 'object' && 'execute' in (val as any)) {
                    tools[name] = val;
                    fileTools.push(name);
                }
            }

            if (fileTools.length > 0) {
                toolsByFile.set(file, fileTools);
                console.log(`[Plugins]: Loaded ${fileTools.length} tool(s) from ${file}: ${fileTools.join(', ')}`);
            } else {
                console.log(`[Plugins]: ${file} — no valid tool exports found`);
            }
        } catch (err) {
            const msg = `[Plugins]: Failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`;
            console.error(msg);
            errors.push(msg);
        }
    }

    return { tools, toolsByFile, errors };
}

/**
 * Load all prompt fragments from custom/prompts/.
 *
 * Files are sorted alphabetically — use numeric prefixes for ordering:
 *   01-persona.md, 02-rules.md, 03-context.md
 *
 * Returns concatenated content with file separators.
 */
async function loadPromptFragments(): Promise<{
    content: string;
    fileCount: number;
    errors: string[];
}> {
    const errors: string[] = [];
    let content = '';
    let fileCount = 0;

    let files: string[];
    try {
        files = await readdir(PROMPTS_DIR);
    } catch {
        return { content, fileCount, errors };
    }

    const validExts = new Set(['.md', '.txt', '.prompt']);

    for (const file of files.sort()) {
        const ext = extname(file);
        if (!validExts.has(ext)) continue;
        if (file.startsWith('.') || file.startsWith('_')) continue;

        const filePath = join(PROMPTS_DIR, file);
        try {
            const text = await readFile(filePath, 'utf-8');
            if (text.trim()) {
                content += `\n\n--- ${file} ---\n${text.trim()}`;
                fileCount++;
            }
        } catch (err) {
            const msg = `[Plugins]: Failed to read prompt ${file}: ${err instanceof Error ? err.message : String(err)}`;
            console.error(msg);
            errors.push(msg);
        }
    }

    if (fileCount > 0) {
        console.log(`[Plugins]: Loaded ${fileCount} prompt fragment(s) from custom/prompts/`);
    }

    return { content, fileCount, errors };
}

/**
 * Load all plugins (tools + prompts) from the custom/ directory.
 *
 * Call this on startup and whenever the agent calls `reload_plugins`.
 */
export async function loadAllPlugins(): Promise<PluginState> {
    await ensurePluginDirs();

    const [toolResult, promptResult] = await Promise.all([
        loadToolPlugins(),
        loadPromptFragments(),
    ]);

    const totalTools = Object.keys(toolResult.tools).length;
    const totalErrors = [...toolResult.errors, ...promptResult.errors];

    if (totalTools > 0 || promptResult.fileCount > 0) {
        console.log(`[Plugins]: Loaded ${totalTools} tool(s), ${promptResult.fileCount} prompt(s)${totalErrors.length ? `, ${totalErrors.length} error(s)` : ''}`);
    }

    return {
        tools: toolResult.tools,
        toolsByFile: toolResult.toolsByFile,
        promptFragments: promptResult.content,
        promptFileCount: promptResult.fileCount,
        errors: totalErrors,
    };
}

/** Get the custom tools directory path */
export function getToolsDir(): string { return TOOLS_DIR; }

/** Get the custom prompts directory path */
export function getPromptsDir(): string { return PROMPTS_DIR; }

/** Get the custom directory root */
export function getCustomDir(): string { return CUSTOM_DIR; }
