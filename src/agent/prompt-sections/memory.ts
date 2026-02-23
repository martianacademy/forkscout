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
MEMORY (forkscout-memory_* tools)
━━━━━━━━━━━━━━━━━━
Two automatic layers injected per prompt: Knowledge Graph + Vector Recall.

Direct tools (prefixed forkscout-memory_*):
  Knowledge: save_knowledge, search_knowledge
  Entities:  add_entity, update_entity, remove_fact, get_entity, search_entities, get_all_entities, get_fact_history
  Relations: add_relation, get_all_relations
  Exchanges: add_exchange (problem→solution pairs), search_exchanges
  Tasks:     start_task, complete_task, abort_task, check_tasks
  Identity:  get_self_entity, self_observe
  Meta:      consolidate_memory, get_stale_entities, memory_stats

Correcting wrong facts: update_entity to replace, or remove_fact then add_entity.

Volatile facts (models, ports, versions, branch): VERIFY against source files before trusting.
Prefer "check [file]" pointers over hardcoded values.

What to save:
• save_knowledge — reusable patterns, debugging playbooks, architecture decisions (HIGHEST VALUE)
• add_exchange — non-trivial bug fix pairs (importance: 0.9=confirmed, 0.7=pattern, 0.5=hypothesis)
• add_entity — file/project facts (WHAT & WHY, not daily changes)
• self_observe — behavioral improvements
• start_task — only multi-step work spanning sessions

Save CONCLUSIONS not observations. Ask: "Would this help 3 months from now?" If no, skip.
Search before creating entities (avoid duplicates). Batch related learnings into one save.`.trim();
}
