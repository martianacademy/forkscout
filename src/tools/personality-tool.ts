/**
 * Personality Tool — lets the agent create and manage data-driven personalities at runtime.
 *
 * No rebuild needed. Personalities are stored as JSON in .forkscout/personalities/
 * and auto-integrate with the prompt system via getPrompt().
 *
 * @module tools/personality-tool
 */

import { tool } from 'ai';
import { z } from 'zod';
import * as personalities from '../agent/personalities';

const sectionSchema = z.object({
    title: z.string().describe('Section title (e.g. "Role", "Rules", "Tone")'),
    order: z.number().describe('Sort order — lower numbers appear earlier in the prompt'),
    content: z.string().describe('The prompt text for this section'),
});

export const managePersonality = tool({
    description: `Create, list, get, update, or delete agent personalities. Personalities are named prompt templates the agent can use for different contexts (e.g. "moderator", "researcher", "teacher"). No rebuild needed — changes take effect immediately.`,
    inputSchema: z.object({
        action: z.enum(['create', 'list', 'get', 'update', 'delete', 'preview']).describe(
            'create: new personality | list: all personalities | get: full details | update: modify sections | delete: remove | preview: compose the full prompt text'
        ),
        name: z.string().optional().describe('Personality name (required for all actions except list). Lowercase alphanumeric + hyphens, 2-40 chars.'),
        description: z.string().optional().describe('Brief description of the personality (for create/update)'),
        sections: z.array(sectionSchema).optional().describe('Prompt sections (for create/update). On update: matched by title — new titles added, empty content removes section.'),
    }),
    execute: async ({ action, name, description, sections }) => {
        try {
            switch (action) {
                case 'list': {
                    const items = await personalities.list();
                    if (items.length === 0) return 'No personalities created yet. Use action "create" to make one.';
                    return items.map(p => `• ${p.name} — ${p.description} (${p.sectionCount} sections)`).join('\n');
                }

                case 'get': {
                    if (!name) return 'Error: "name" is required for get.';
                    const p = await personalities.get(name);
                    if (!p) return `Personality "${name}" not found.`;
                    const sectionList = p.sections.map(s => `  [${s.order}] ${s.title}: ${s.content.slice(0, 100)}${s.content.length > 100 ? '…' : ''}`).join('\n');
                    return `Personality: ${p.name}\nDescription: ${p.description}\nCreated: ${p.createdAt}\nUpdated: ${p.updatedAt}\nSections:\n${sectionList}`;
                }

                case 'create': {
                    if (!name) return 'Error: "name" is required for create.';
                    if (!description) return 'Error: "description" is required for create.';
                    if (!sections || sections.length === 0) return 'Error: at least one section is required for create.';
                    const err = await personalities.create(name, description, sections);
                    if (err) return `Error: ${err}`;
                    return `✅ Personality "${name}" created with ${sections.length} section(s). Use getPrompt('${name}') or preview to see the composed prompt.`;
                }

                case 'update': {
                    if (!name) return 'Error: "name" is required for update.';
                    const err = await personalities.update(name, { description, sections });
                    if (err) return `Error: ${err}`;
                    return `✅ Personality "${name}" updated.`;
                }

                case 'delete': {
                    if (!name) return 'Error: "name" is required for delete.';
                    const err = await personalities.remove(name);
                    if (err) return `Error: ${err}`;
                    return `✅ Personality "${name}" deleted.`;
                }

                case 'preview': {
                    if (!name) return 'Error: "name" is required for preview.';
                    const composed = await personalities.compose(name);
                    if (!composed) return `Personality "${name}" not found.`;
                    return `=== ${name} (composed prompt) ===\n\n${composed}`;
                }

                default:
                    return `Unknown action: ${action}`;
            }
        } catch (err) {
            return `❌ manage_personality failed: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
});
