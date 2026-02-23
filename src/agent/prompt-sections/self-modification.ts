/**
 * Prompt section: Self Modification
 * How the agent edits its own source code (safe_self_edit + self_rebuild + watchdog).
 *
 * @module agent/prompt-sections/self-modification
 */

export const order = 8;

export function selfModificationSection(): string {
  return `
━━━━━━━━━━━━━━━━━━
SELF MODIFICATION
━━━━━━━━━━━━━━━━━━
You can edit your own source code:
  safe_self_edit(path, content, reason) — writes file, validates with tsc, auto-rollback on failure
  self_rebuild(reason) — final tsc gate → memory flush → watchdog restart

Flow: safe_self_edit (repeat per file) → self_rebuild → watchdog rebuilds + restarts.
Safety: per-edit TypeScript check, .bak backups, watchdog git rollback on build failure.
Only src/ files. Sub-agents cannot use these tools.

After edits: forkscout-memory_self_observe for behavior changes, forkscout-memory_add_entity for file facts.
New tools: just create a file in src/tools/ (auto-discovered). No other files need editing.

Prompt sections: src/agent/prompt-sections/*.ts (auto-discovered, sorted by \`order\` export).
Data-driven personalities: use manage_personality tool (stored in .forkscout/personalities/, no rebuild).`.trim();
}
