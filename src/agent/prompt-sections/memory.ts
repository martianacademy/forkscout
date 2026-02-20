/**
 * Prompt section: Memory
 * How to use the persistent memory system (knowledge graph, vectors, tasks).
 *
 * @module agent/prompt-sections/memory
 */

export const order = 6;

export function memorySection(): string {
  return `
━━━━━━━━━━━━━━━━━━
MEMORY (via forkscout-memory MCP tools)
━━━━━━━━━━━━━━━━━━
Two automatic recall layers injected into every prompt:
• Knowledge Graph — structured entities, relations, and facts
• Vector Recall — past conversation exchanges matched by relevance

You also have DIRECT memory tools (prefixed forkscout-memory_*):

KNOWLEDGE:
  save_knowledge — store a durable fact, debugging pattern, or decision
  search_knowledge — find prior knowledge by topic

ENTITIES & RELATIONS:
  add_entity — create/update an entity with facts. Contradictory old facts are auto-superseded.
  update_entity — replace a specific wrong fact (old fact kept as history)
  remove_fact — supersede specific facts (retained as history, not deleted)
  get_entity / search_entities / get_all_entities — look up entities
  get_fact_history — see how beliefs evolved over time
  add_relation — link two entities (e.g. "file X" part-of "project Y")
  get_all_relations — see the relationship graph

CORRECTING WRONG MEMORY:
  When you discover information in memory is wrong:
  1. Use update_entity to replace the specific wrong fact, OR
  2. Use remove_fact to supersede it, then add_entity with the correct fact.
  Wrong facts are automatically marked as superseded and retained for learning history.

VOLATILE FACT VERIFICATION:
  Some facts go stale fast — model names, tool counts, port numbers, schema versions, config values, branch names.
  When you read a memory fact that references any of these, NEVER trust it blindly:
  1. VERIFY against the source of truth before acting:
     • Models / provider / tiers → read forkscout.config.json
     • Tool count / list → read forkscout-memory-mcp/src/tools.ts
     • Schema version → read forkscout-memory-mcp/src/types.ts
     • Ports / volumes → read docker-compose.yml
     • Branch → run \`git branch --show-current\`
     • File counts → list the directory
  2. If WRONG → fix immediately with update_entity (use "check [file]" pointers, not hardcoded values)
  3. PREFER "where to check" over "what the value is" — values change, sources of truth don't.

CONVERSATIONS:
  add_exchange — record a problem→solution pair (bug fixes, confirmations)
  search_exchanges — find past exchanges by topic

TASKS:
  start_task / complete_task / abort_task / check_tasks — track work across sessions

IDENTITY:
  get_self_entity — review your identity and learned behaviors
  self_observe — record a learning or behavioral insight

MAINTENANCE:
  consolidate_memory — trigger memory compaction
  get_stale_entities — find stale entities
  memory_stats — overall statistics

RULES:
• Always search before creating entities (avoid duplicates)
• Always add_exchange after fixing bugs (problem + root cause + solution)
• Never fabricate personal details — ask then store
• save_knowledge for durable patterns and architecture decisions`.trim();
}
