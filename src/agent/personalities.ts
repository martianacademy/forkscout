/**
 * Data-Driven Personality Manager — runtime CRUD for agent personalities.
 *
 * Personalities are stored as JSON files in .forkscout/personalities/{name}.json.
 * Unlike code-based prompt sections, these require no TypeScript compilation or rebuild.
 * The agent can create, edit, and delete personalities at runtime via the personality tool.
 *
 * Each personality is a named collection of ordered text sections that compose into a system prompt.
 *
 * @module agent/personalities
 */

import { resolve } from 'path';
import { AGENT_ROOT } from '../paths';

// ── Types ────────────────────────────────────────────

export interface PersonalitySection {
    /** Display title for the section */
    title: string;
    /** Sort order (lower = earlier in prompt) */
    order: number;
    /** The prompt text for this section */
    content: string;
}

export interface Personality {
    /** Unique name (used as filename and prompt type key) */
    name: string;
    /** Brief description of this personality */
    description: string;
    /** Ordered prompt sections */
    sections: PersonalitySection[];
    /** ISO timestamp of creation */
    createdAt: string;
    /** ISO timestamp of last modification */
    updatedAt: string;
}

// ── Reserved names (cannot create data-driven personalities with these) ──

const RESERVED_NAMES = new Set(['admin', 'guest', 'sub-agent']);

// ── Storage directory ────────────────────────────────

const PERSONALITIES_DIR = resolve(AGENT_ROOT, '.forkscout', 'personalities');

// ── In-memory cache ──────────────────────────────────

let cache: Map<string, Personality> | null = null;

async function ensureDir(): Promise<void> {
    const fs = await import('fs/promises');
    await fs.mkdir(PERSONALITIES_DIR, { recursive: true });
}

function filePath(name: string): string {
    return resolve(PERSONALITIES_DIR, `${name}.json`);
}

/** Validate a personality name — lowercase alphanumeric + hyphens, 2-40 chars */
function validateName(name: string): string | null {
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) {
        return 'Name must be 2-40 chars, lowercase alphanumeric + hyphens, starting with a letter.';
    }
    if (RESERVED_NAMES.has(name)) {
        return `"${name}" is reserved for code-based prompt types. Choose a different name.`;
    }
    return null;
}

// ── Public API ───────────────────────────────────────

/** Load all personalities from disk (cached after first call). */
export async function loadAll(): Promise<Map<string, Personality>> {
    if (cache) return cache;

    const fs = await import('fs/promises');
    cache = new Map();

    try {
        await ensureDir();
        const files = await fs.readdir(PERSONALITIES_DIR);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
                const raw = await fs.readFile(resolve(PERSONALITIES_DIR, file), 'utf-8');
                const p: Personality = JSON.parse(raw);
                if (p.name && Array.isArray(p.sections)) {
                    // Ensure sections are sorted
                    p.sections.sort((a, b) => a.order - b.order);
                    cache.set(p.name, p);
                }
            } catch { /* skip corrupt file */ }
        }
    } catch { /* directory doesn't exist yet */ }

    return cache;
}

/** Invalidate cache so next loadAll() re-reads from disk. */
export function invalidateCache(): void {
    cache = null;
}

/** List all data-driven personality names with descriptions. */
export async function list(): Promise<Array<{ name: string; description: string; sectionCount: number }>> {
    const all = await loadAll();
    return [...all.values()].map(p => ({
        name: p.name,
        description: p.description,
        sectionCount: p.sections.length,
    }));
}

/** Get a single personality by name. */
export async function get(name: string): Promise<Personality | null> {
    const all = await loadAll();
    return all.get(name) ?? null;
}

/** Compose a personality's sections into a single prompt string. */
export async function compose(name: string): Promise<string | null> {
    const p = await get(name);
    if (!p) return null;
    return p.sections
        .map(s => s.content.trim())
        .filter(Boolean)
        .join('\n\n');
}

/** Create a new personality. Returns error string or null on success. */
export async function create(
    name: string,
    description: string,
    sections: PersonalitySection[],
): Promise<string | null> {
    const nameErr = validateName(name);
    if (nameErr) return nameErr;

    const all = await loadAll();
    if (all.has(name)) return `Personality "${name}" already exists. Use update to modify it.`;

    const now = new Date().toISOString();
    const personality: Personality = {
        name,
        description,
        sections: [...sections].sort((a, b) => a.order - b.order),
        createdAt: now,
        updatedAt: now,
    };

    await ensureDir();
    const fs = await import('fs/promises');
    await fs.writeFile(filePath(name), JSON.stringify(personality, null, 2), 'utf-8');
    all.set(name, personality);

    return null;
}

/**
 * Update a personality — can change description and/or replace/add/remove sections.
 * Sections are matched by title. New titles are added, existing titles are replaced.
 * To remove a section, set its content to empty string.
 */
export async function update(
    name: string,
    changes: {
        description?: string;
        sections?: PersonalitySection[];
    },
): Promise<string | null> {
    const all = await loadAll();
    const existing = all.get(name);
    if (!existing) return `Personality "${name}" not found.`;

    if (changes.description !== undefined) {
        existing.description = changes.description;
    }

    if (changes.sections) {
        for (const incoming of changes.sections) {
            const idx = existing.sections.findIndex(s => s.title === incoming.title);
            if (incoming.content.trim() === '') {
                // Remove section
                if (idx >= 0) existing.sections.splice(idx, 1);
            } else if (idx >= 0) {
                // Update existing section
                existing.sections[idx] = incoming;
            } else {
                // Add new section
                existing.sections.push(incoming);
            }
        }
        existing.sections.sort((a, b) => a.order - b.order);
    }

    existing.updatedAt = new Date().toISOString();

    await ensureDir();
    const fs = await import('fs/promises');
    await fs.writeFile(filePath(name), JSON.stringify(existing, null, 2), 'utf-8');

    return null;
}

/** Delete a personality. Returns error string or null on success. */
export async function remove(name: string): Promise<string | null> {
    const all = await loadAll();
    if (!all.has(name)) return `Personality "${name}" not found.`;

    const fs = await import('fs/promises');
    try {
        await fs.rm(filePath(name));
    } catch { /* file already gone */ }
    all.delete(name);

    return null;
}

/** Get all personality names (for prompt type integration). */
export async function getPersonalityNames(): Promise<string[]> {
    const all = await loadAll();
    return [...all.keys()];
}
