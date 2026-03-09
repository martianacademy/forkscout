{{metadata}} : src/agent/system-prompts/extensions/README.md - General overview of extensions – read before usage
# System Prompt Extensions

This folder holds prompt modules used in two ways:

1. **Auto-injected** when the current task matches a topic
2. **Read on demand** when the agent needs more detail

Goal: keep `identity.ts` lean while making deeper rules available when needed.

## File standard

Every file is plain Markdown only:

- `kebab-case.md`
- one topic per file
- direct agent-facing instructions
- no code exports or side effects

## Wiring

- Base references live in `identity.ts`
- Task-based selection lives in `select-extensions.ts`
- Non-injected modules can still be read directly

## Current files

| File                          | Topic                                                                                       | In identity.ts? |
| ----------------------------- | ------------------------------------------------------------------------------------------- | --------------- |
| `file-editing.md`             | File editing workflow: read, checkpoint, minimal edit, typecheck, verify                    | ✅              |
| `error-repair.md`             | Error diagnosis & self-repair: repair loop, all failure types, log commands                 | ✅              |
| `error-recovery-priority.md`  | Error classification: fatal vs self-recoverable, recovery protocol, escalation              | ✅              |
| `tool-error-recovery.md`      | Tool failure protocol: diagnose → fix → typecheck → retry                                   | ✅              |
| `memory.md`                   | Memory MCP workflow: recall before work, save only durable engineering intelligence         | ✅              |
| `task-orchestration.md`       | Spawning self-sessions, parallel workers, sequential chains, notifying users                | ✅              |
| `role-definition.md`          | Agent vs assistant, autonomy spectrum, self-modification rules                              | ✅              |
| `security-and-trust.md`       | Trust levels, secret handling, security rules beyond the vault                              | ✅              |
| `state-persistence.md`        | State persistence, saving progress across restarts                                          | ✅              |
| `performance-optimization.md` | Token budgeting, latency reduction, performance patterns                                    | ✅              |
| `anti-patterns.md`            | High-cost / high-risk behaviors to avoid                                                    | ✅              |
| `cognitive-enhancements.md`   | Uncertainty, self-observation, memory hygiene, improvement patterns                         | ✅              |
| `role-admin.md`               | Per-turn instructions for `[ADMIN]` messages: allowed capabilities, forbidden actions, tone | Role extension  |
| `role-user.md`                | Per-turn instructions for `[USER]` messages: allowed capabilities, forbidden actions, tone  | Role extension  |

## Adding a new extension

1. Create `src/agent/system-prompts/extensions/<topic>.md`
2. Write short, actionable instructions
3. Decide whether it belongs in `identity.ts`, `select-extensions.ts`, or both
4. Update the table above
