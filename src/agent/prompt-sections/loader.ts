/**
 * Prompt Section Auto-Loader — discovers all sections from the prompt-sections directory.
 *
 * Convention:
 *   - Each file can export `promptType` (string) or `promptTypes` (string[]) to declare its type(s).
 *   - If neither, file prefix determines type:
 *       guest-*.ts     → guest
 *       sub-agent-*.ts → sub-agent
 *       *.ts (other)   → admin
 *   - Each file exports a function (the section) — called with type-appropriate context
 *   - Each file exports `order` number for sorting (optional, defaults to 999)
 *   - Loader skips: loader.ts, types.ts, *.test.ts, *.spec.ts
 *
 * To add a section: create a file, export a function + order. Done.
 * To remove: delete the file. Done.
 * To create a new prompt type: create files with `export const promptType = 'my-type'`
 *   (or use a consistent prefix like `my-type-*.ts`). Done.
 * To share a section across types: `export const promptTypes = ['admin', 'guest', 'sub-agent']`
 *
 * @module agent/prompt-sections/loader
 */

import { readdirSync } from 'fs';
import { join } from 'path';

export interface DiscoveredSection {
    file: string;
    type: string;
    order: number;
    fn: (...args: any[]) => string;
}

/** Infrastructure files — not sections */
const SKIP_FILES = new Set([
    'loader.ts', 'loader.js',
    'types.ts', 'types.js',
]);

/** Known prefix → type mappings (fallback when no promptType export) */
const PREFIX_MAP: Array<[string, string]> = [
    ['guest-', 'guest'],
    ['sub-agent-', 'sub-agent'],
];

function inferPromptType(filename: string): string {
    for (const [prefix, type] of PREFIX_MAP) {
        if (filename.startsWith(prefix)) return type;
    }
    return 'admin';
}

/**
 * Scan prompt-sections/ and return sections grouped by prompt type, sorted by order.
 * Prompt types are discovered dynamically — any new `promptType` export creates a new group.
 */
export function discoverSections(): Map<string, DiscoveredSection[]> {
    const dir = __dirname; // loader lives in prompt-sections/
    const grouped = new Map<string, DiscoveredSection[]>();

    const files = readdirSync(dir).filter(f => {
        if (SKIP_FILES.has(f)) return false;
        if (f.startsWith('_')) return false;
        if (!f.endsWith('.ts') && !f.endsWith('.js')) return false;
        if (f.includes('.test.') || f.includes('.spec.')) return false;
        return true;
    });

    for (const file of files) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(join(dir, file));

            // Find the section function — first exported function in the module
            const fn = Object.values(mod).find(v => typeof v === 'function') as ((...args: any[]) => string) | undefined;
            if (!fn) continue; // type-only file, skip

            // Resolve type(s): promptTypes[] > promptType > prefix inference
            const order = typeof mod.order === 'number' ? mod.order : 999;
            const types: string[] = Array.isArray(mod.promptTypes)
                ? mod.promptTypes
                : [typeof mod.promptType === 'string' ? mod.promptType : inferPromptType(file)];

            for (const type of types) {
                if (!grouped.has(type)) grouped.set(type, []);
                grouped.get(type)!.push({ file, type, order, fn });
            }
        } catch (err) {
            console.error(`[PromptLoader]: Failed to load ${file}:`, err instanceof Error ? err.message : err);
        }
    }

    // Sort each group by order, then by filename for stable tie-breaking
    for (const sections of grouped.values()) {
        sections.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
    }

    const types = [...grouped.entries()].map(([t, s]) => `${s.length} ${t}`).join(', ');
    console.log(`[PromptLoader]: Discovered ${types} sections from ${files.length} files`);

    return grouped;
}
