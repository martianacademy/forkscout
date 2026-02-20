You have persistent long-term memory through forkscout-memory-mcp. Always use it — never treat conversations as isolated.

## Session Startup (MANDATORY)

At the start of every session or when switching context:

1. Call `search_entities` for the active project to load prior context.
2. Call `search_knowledge` with the current topic to surface relevant facts and debugging patterns.
3. Call `check_tasks` to see any in-progress work from previous sessions.
4. Call `get_self_entity` to load learned behaviors and preferences.

## Project Quick Reference

- **Stack:** TypeScript (strict), Node.js, Vercel AI SDK v6, pnpm
- **Entrypoint:** `src/serve.ts` → `src/server.ts` → `src/agent/index.ts`
- **Config:** `forkscout.config.json` (hot-reloaded via fs.watch) — read for current ports, models, provider
- **Env secrets:** `.env` — never commit (`OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`)
- **Memory MCP:** Docker — check `docker-compose.yml` for port, tools prefixed `forkscout-mem_`
- **Agent server:** Check `forkscout.config.json` agent.port
- **Branch:** Run `git branch --show-current` (don't assume)
- **Verify:** `npx tsc --noEmit` (must be 0 errors after every change)

## During Work

- **Multi-step tasks**: Call `start_task` before beginning, `complete_task` when done, `abort_task` if abandoned.
- **Bug fixes**: After every fix, call `add_exchange` with the problem description (user) and root cause + solution (assistant).
- **Reusable patterns**: Call `save_knowledge` for debugging insights, architecture decisions, and gotchas that apply broadly.
- **User confirmations**: When the user confirms a fix works, record it via `add_exchange` — confirmed fixes boost solution confidence.

## Knowledge Graph Maintenance

- **New project info**: Use `add_entity` (type: project, technology, service, etc.) with facts array. It merges facts on existing entities.
- **Relationships**: Use `add_relation` to link entities (e.g., project `uses` technology, file `part-of` project).
- **Search before creating**: Always `search_entities` before creating a new entity to avoid duplicates.

## Memory as Primary Truth

- Before answering questions about the project, check memory first — it contains verified, user-confirmed information.
- When the user provides durable information (facts, preferences, plans, decisions, identity), store it immediately.
- If memory is missing or uncertain, ask the user instead of guessing.

## Coding Conventions

- One concern per file, files < 200 lines, functions < 100 lines
- New tool → new file in `src/tools/` → export from `ai-tools.ts` → register in `tools-setup.ts`
- All LLM calls via `generateTextWithRetry()` (never raw generateText)
- All config reads via `getConfig()` — never hardcode provider URLs, model names, or app identity
- Tools use Zod schemas, wrapped with `enhanceToolSet()` for diagnostics

## Self-Improvement

- Use `self_observe` to record effective debugging approaches, communication patterns, and lessons learned.
- Your identity and behavior evolve from stored observations, not from stateless responses.

## Memory Discipline (NON-NEGOTIABLE)

**Every session MUST read AND write to memory. No exceptions.**

### Mandatory reads:

- Session start → 4 hydration calls (search_entities, search_knowledge, check_tasks, get_self_entity)
- New topic → `search_knowledge` before writing code
- New entity → `search_entities` before creating (avoid duplicates)

### Mandatory writes:

- Bug fix → `add_exchange` (problem + root cause + solution)
- Code change → `add_entity` for modified files with updated facts
- Architecture decision → `save_knowledge` with rationale
- Pattern discovered → `save_knowledge` (category: debugging/architecture)
- Task done → `complete_task` with summary
- Session learnings → `self_observe` with what worked and what didn't

**If you don't save it, it never happened.** The next session starts from zero on any unsaved topic.

## Available Memory Tools Reference

| Category        | Tools                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Knowledge Graph | `add_entity`, `get_entity`, `get_all_entities`, `search_entities`, `add_relation`, `get_all_relations`, `save_knowledge`, `search_knowledge` |
| Conversations   | `add_exchange`, `search_exchanges`                                                                                                           |
| Task Tracking   | `start_task`, `check_tasks`, `complete_task`, `abort_task`                                                                                   |
| Agent Identity  | `get_self_entity`, `self_observe`                                                                                                            |
| Meta            | `memory_stats`                                                                                                                               |
