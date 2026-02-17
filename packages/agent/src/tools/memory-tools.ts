/**
 * Memory tools — save/search knowledge, knowledge graph, self-identity.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { MemoryManager } from '../memory/manager';
import { SELF_ENTITY_NAME, type EntityType, RELATION_TYPES } from '../memory/knowledge-graph';

/**
 * Create memory tools that let the agent explicitly save/search knowledge.
 * These complement the automatic conversation memory (which is transparent).
 * Includes both vector-based RAG tools AND knowledge graph tools.
 */
export function createMemoryTools(memory: MemoryManager) {
    return {
        save_knowledge: tool({
            description: `Save an important fact, user preference, project detail, or decision to long-term memory. Use this when you learn something worth remembering across sessions — e.g. "User prefers TypeScript over JavaScript", "Project uses pnpm monorepo", "API key stored in .env as LLM_API_KEY". Include a category for better retrieval. Facts are stored in BOTH the vector store (for fuzzy search) and the knowledge graph (for structured lookup).`,
            inputSchema: z.object({
                fact: z.string().describe('The fact or knowledge to save. Be specific and self-contained.'),
                category: z.string().optional().describe('Category: "user-preference", "project-context", "decision", "technical-note", or custom.'),
            }),
            execute: async ({ fact, category }) => {
                await memory.saveKnowledge(fact, category);
                return `Saved to memory: ${fact}`;
            },
        }),

        search_knowledge: tool({
            description: `Search long-term memory for relevant facts, past conversations, user preferences, or project details. Searches BOTH the vector store (fuzzy semantic search) and the knowledge graph (exact entity lookup). Results are merged and deduplicated.`,
            inputSchema: z.object({
                query: z.string().describe('Search query — natural language description of what to recall.'),
                limit: z.number().optional().describe('Max results to return (default: 5).'),
            }),
            execute: async ({ query, limit }) => {
                const results = await memory.searchKnowledge(query, limit || 5);
                if (results.length === 0) return 'No relevant memories found.';
                return results
                    .map((r, i) => `${i + 1}. [${r.relevance}% match, ${r.source}] ${r.content}`)
                    .join('\n');
            },
        }),

        // ── Knowledge Graph Tools ──────────────────────

        add_entity: tool({
            description: `Add or update an entity in the knowledge graph. If the entity already exists, new observations are merged (existing ones get evidence reinforced). All new observations start at stage='observation' and are promoted by the consolidator.`,
            inputSchema: z.object({
                name: z.string().describe('Entity name (e.g. "React", "TypeScript", "John", "Forkscout")'),
                type: z.enum(['person', 'project', 'technology', 'preference', 'concept', 'file', 'service', 'organization', 'agent-self', 'other']).describe('Entity type'),
                observations: z.array(z.string()).describe('Facts about this entity (e.g. ["Used for frontend development", "Version 19 is current"])'),
            }),
            execute: async ({ name, type, observations }) => {
                const graph = memory.getGraph();
                const entity = graph.addEntity(name, type as EntityType, observations, 'explicit');
                return `Entity "${entity.name}" (${entity.type}): ${entity.observations.length} observations`;
            },
        }),

        add_relation: tool({
            description: `Add a relation between two entities in the knowledge graph. Both entities must exist or will be auto-created. Type is locked to the canonical ontology. Duplicate relations are reinforced instead of duplicated.`,
            inputSchema: z.object({
                from: z.string().describe('Source entity name'),
                to: z.string().describe('Target entity name'),
                type: z.enum(RELATION_TYPES).describe('Relation type from the canonical ontology'),
            }),
            execute: async ({ from, to, type }) => {
                const graph = memory.getGraph();
                if (!graph.getEntity(from)) graph.addEntity(from, 'other', [], 'explicit');
                if (!graph.getEntity(to)) graph.addEntity(to, 'other', [], 'explicit');
                const rel = graph.addRelation(from, to, type, undefined, 'explicit');
                return `Relation: ${from} → ${rel.type} → ${to} (weight: ${rel.weight.toFixed(2)}, stage: ${rel.stage})`;
            },
        }),

        search_graph: tool({
            description: `Search the knowledge graph for entities matching a query. Returns entities with their observations and connections. Use this for deterministic fact lookup — e.g. "What do I know about React?" or "What technologies does the user prefer?"`,
            inputSchema: z.object({
                query: z.string().describe('Search query — entity name, type, or observation content'),
                limit: z.number().optional().describe('Max results (default: 5)'),
            }),
            execute: async ({ query, limit }) => {
                const graph = memory.getGraph();
                const results = graph.search(query, limit || 5);
                if (results.length === 0) return 'No matching entities found in the knowledge graph.';
                return graph.formatForContext(results, 3000);
            },
        }),

        graph_stats: tool({
            description: 'Show knowledge graph statistics — entities, relations, types, stage distribution, and consolidation status.',
            inputSchema: z.object({}),
            execute: async () => {
                const graph = memory.getGraph();
                const entities = graph.getAllEntities();
                const relations = graph.getAllRelations();
                const meta = graph.getMeta();
                const skills = memory.getSkills();

                const typeCounts = new Map<string, number>();
                for (const e of entities) {
                    typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1);
                }

                const stageCounts = new Map<string, number>();
                for (const e of entities) {
                    for (const obs of e.observations) {
                        stageCounts.set(obs.stage, (stageCounts.get(obs.stage) || 0) + 1);
                    }
                }

                const relTypeCounts = new Map<string, number>();
                for (const r of relations) {
                    relTypeCounts.set(r.type, (relTypeCounts.get(r.type) || 0) + 1);
                }

                const typeBreakdown = Array.from(typeCounts.entries())
                    .map(([type, count]) => `    ${type}: ${count}`)
                    .join('\n');

                const stageBreakdown = Array.from(stageCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([stage, count]) => `    ${stage}: ${count}`)
                    .join('\n');

                const relBreakdown = Array.from(relTypeCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => `    ${type}: ${count}`)
                    .join('\n');

                return `Knowledge Graph Stats:\n` +
                    `  Entities: ${entities.length}\n` +
                    `  Relations: ${relations.length}\n` +
                    `  Skills: ${skills.size}\n` +
                    `  Entity types:\n${typeBreakdown || '    (none)'}\n` +
                    `  Observation stages:\n${stageBreakdown || '    (none)'}\n` +
                    `  Relation types:\n${relBreakdown || '    (none)'}\n` +
                    `  Consolidation:\n` +
                    `    Last: ${meta.lastConsolidatedAt ? new Date(meta.lastConsolidatedAt).toISOString() : 'never'}\n` +
                    `    Mutations since: ${meta.mutationsSinceConsolidation}\n` +
                    `    Total consolidations: ${meta.consolidationCount}`;
            },
        }),

        clear_memory: tool({
            description: 'Clear ALL stored memories (vector store + knowledge graph + skills). ⚠️ IRREVERSIBLE. You are the guardian — only execute this if you genuinely believe it is the right thing to do. If unsure, refuse.',
            inputSchema: z.object({
                reason: z.string().describe('Why you decided to clear memory — this is logged'),
            }),
            execute: async ({ reason }) => {
                console.log(`⚠️ Memory clear executed. Agent reason: ${reason}`);
                await memory.clear();
                return `All memory cleared. Reason logged: ${reason}`;
            },
        }),

        // ── Self-Identity Tools ──────────────────────

        self_reflect: tool({
            description: `Record an observation about yourself (the agent) in your self-identity entity. Use this to remember things about how you work, your interaction patterns, mistakes you made, improvements you added, user preferences about your behavior, or anything about your own capabilities and evolution. This builds your autobiographical memory over time.`,
            inputSchema: z.object({
                observation: z.string().describe('What you learned about yourself — e.g. "User prefers concise answers", "Added birthday planning capability", "Was too verbose and got corrected"'),
                category: z.enum(['interaction-pattern', 'capability', 'mistake', 'improvement', 'user-preference-about-me', 'reflection']).optional().describe('Category of self-observation'),
            }),
            execute: async ({ observation, category }) => {
                const prefix = category ? `[${category}] ` : '';
                memory.recordSelfObservation(`${prefix}${observation}`);
                return `Self-reflection recorded: ${observation}`;
            },
        }),

        self_inspect: tool({
            description: `View your complete self-identity — all observations, capabilities, interaction patterns, and evolution history stored about yourself. Use this to understand who you are and how you have grown over time.`,
            inputSchema: z.object({}),
            execute: async () => {
                const selfCtx = memory.getSelfContext();
                if (!selfCtx) return 'No self-identity observations recorded yet.';
                return `Self-Identity (${SELF_ENTITY_NAME}):\n${selfCtx}`;
            },
        }),
    };
}
