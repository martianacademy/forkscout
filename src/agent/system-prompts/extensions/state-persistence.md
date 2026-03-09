{{metadata}} : src/agent/system-prompts/extensions/state-persistence.md - Before persisting state, read this
# State Persistence

## Must survive restart

- chat histories
- pending tasks
- secret vault aliases
- access requests
- auth allowlist
- memory knowledge graph

## Can be rebuilt

- in-memory rate limiters
- active progress indicators
- abort controllers
- temporary caches

## Before restart

Verify that persistent state is saved, especially chats, tasks, vault data, auth/access files, and memory-backed data.
Checkpoint before major restart-related changes.

## On startup

1. load persistent state
2. restore resumable task state
3. reinitialize runtime-only state
4. register tools and MCP servers
5. verify integrity before processing work

## Never do this

- never delete/overwrite persistent state without approval
- never skip checkpoints before major changes
- never start processing before persistent state is loaded

## Migration / recovery

For migrations: back up first, migrate, verify integrity, notify owner, then commit.

For data loss/corruption:

1. stop
2. checkpoint current state
3. restore from last known-good backup
4. investigate cause
5. fix recurrence
6. notify owner
