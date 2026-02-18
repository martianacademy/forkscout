/**
 * Memory tools — save/search knowledge, entities, self-identity.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { MemoryManager, SELF_ENTITY_NAME, RELATION_TYPES, type EntityType } from '../memory';

/** Create memory tools for explicit knowledge management. */
export function createMemoryTools(memory: MemoryManager) {
    return {
        save_knowledge: tool({
            description: `Save an important fact, preference, or decision to long-term memory.`,
            inputSchema: z.object({
                fact: z.string().describe('The fact to save. Be specific and self-contained.'),
                category: z.string().optional().describe('Category: "user-preference", "project-context", "decision", etc.'),
            }),
            execute: async ({ fact, category }) => {
                await memory.saveKnowledge(fact, category);
                return `Saved to memory: ${fact}`;
            },
        }),

        search_knowledge: tool({
            description: `Search long-term memory for facts, past conversations, or preferences.`,
            inputSchema: z.object({
                query: z.string().describe('Natural language search query.'),
                limit: z.number().optional().describe('Max results (default: 5).'),
            }),
            execute: async ({ query, limit }) => {
                const results = await memory.searchKnowledge(query, limit || 5);
                if (results.length === 0) return 'No relevant memories found.';
                return results.map((r, i) => `${i + 1}. [${r.relevance}%, ${r.source}] ${r.content}`).join('\n');
            },
        }),

        add_entity: tool({
            description: `Add or update an entity in the knowledge graph. Duplicate facts are deduplicated.`,
            inputSchema: z.object({
                name: z.string().describe('Entity name'),
                type: z.enum(['person', 'project', 'technology', 'preference', 'concept', 'file', 'service', 'organization', 'agent-self', 'other']).describe('Entity type'),
                observations: z.array(z.string()).describe('Facts about this entity'),
            }),
            execute: async ({ name, type, observations }) => {
                const entity = memory.addEntity(name, type as EntityType, observations);
                return `Entity "${entity.name}" (${entity.type}): ${entity.facts.length} facts`;
            },
        }),

        add_relation: tool({
            description: `Add a relation between two entities. Auto-creates entities if missing.`,
            inputSchema: z.object({
                from: z.string().describe('Source entity name'),
                to: z.string().describe('Target entity name'),
                type: z.enum(RELATION_TYPES).describe('Relation type'),
            }),
            execute: async ({ from, to, type }) => {
                if (!memory.getEntity(from)) memory.addEntity(from, 'other', []);
                if (!memory.getEntity(to)) memory.addEntity(to, 'other', []);
                const rel = memory.addRelation(from, type, to);
                return `Relation: ${from} → ${rel.type} → ${to}`;
            },
        }),

        search_graph: tool({
            description: `Search knowledge graph for matching entities.`,
            inputSchema: z.object({
                query: z.string().describe('Search query — entity name, type, or fact content'),
                limit: z.number().optional().describe('Max results (default: 5)'),
            }),
            execute: async ({ query, limit }) => {
                const entities = memory.getAllEntities().length > 0
                    ? memory.getStore().searchEntities(query, limit || 5)
                    : [];
                if (entities.length === 0) return 'No matching entities found.';
                return entities.map(e => `• ${e.name} (${e.type}): ${e.facts.slice(0, 5).join('; ')}`).join('\n');
            },
        }),

        graph_stats: tool({
            description: 'Show memory statistics.',
            inputSchema: z.object({}),
            execute: async () => {
                const s = memory.getStats();
                const entities = memory.getAllEntities();
                const types = new Map<string, number>();
                for (const e of entities) types.set(e.type, (types.get(e.type) || 0) + 1);
                const breakdown = Array.from(types.entries()).map(([t, c]) => `    ${t}: ${c}`).join('\n');
                return `Memory Stats:\n  Entities: ${s.entities}\n  Relations: ${s.relations}\n  Exchanges: ${s.exchanges}\n  Types:\n${breakdown || '    (none)'}`;
            },
        }),

        clear_memory: tool({
            description: 'Clear ALL stored memories. ⚠️ IRREVERSIBLE.',
            inputSchema: z.object({ reason: z.string().describe('Why — this is logged') }),
            execute: async ({ reason }) => {
                console.log(`⚠️ Memory clear: ${reason}`);
                await memory.clear();
                return `All memory cleared. Reason: ${reason}`;
            },
        }),

        self_reflect: tool({
            description: `Record a self-observation about yourself — interaction patterns, mistakes, improvements, capabilities.`,
            inputSchema: z.object({
                observation: z.string().describe('What you learned about yourself'),
                category: z.enum(['interaction-pattern', 'capability', 'mistake', 'improvement', 'user-preference-about-me', 'reflection']).optional(),
            }),
            execute: async ({ observation, category }) => {
                memory.recordSelfObservation(category ? `[${category}] ${observation}` : observation);
                return `Self-reflection recorded: ${observation}`;
            },
        }),

        self_inspect: tool({
            description: `View your complete self-identity — all observations and evolution history.`,
            inputSchema: z.object({}),
            execute: async () => {
                const ctx = memory.getSelfContext();
                return ctx ? `Self-Identity (${SELF_ENTITY_NAME}):\n${ctx}` : 'No self-identity observations yet.';
            },
        }),
    };
}
