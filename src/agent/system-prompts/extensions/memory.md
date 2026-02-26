# Memory Usage Guide

> Read this when: starting a new session, about to work on a task, or deciding what to save to memory.

---

## Tools

All memory tools are prefixed `forkscout-mem__` (via the forkscout_memory MCP server).

---

## Session Startup (MANDATORY)

At the start of every new session, run these before doing any work:

```
forkscout-mem__search_knowledge  query="<current task or feature>"
forkscout-mem__check_tasks       → see in-progress tasks from last session
forkscout-mem__search_entities   query="<components you'll be touching>"
```

Skipping this means ignoring verified knowledge from prior sessions.

---

## What TO Save

| Event              | Tool                          | What to store                             |
| ------------------ | ----------------------------- | ----------------------------------------- |
| Bug fixed          | `add_exchange`                | Exact problem, root cause, fix applied    |
| Pattern discovered | `save_knowledge`              | Reusable insight (`project: "forkscout"`) |
| Decision made      | `save_knowledge`              | Why this approach was chosen              |
| New entity added   | `add_entity` + `add_relation` | Provider/channel/tool + its relationships |
| Task completed     | `complete_task`               | Result summary                            |
| Tricky gotcha      | `self_observe`                | Behavioral correction or learned rule     |

---

## What NOT to Save

- Raw command output or log dumps
- Auto-generated boilerplate
- Obvious facts already in the codebase ("config lives in config.json")
- Temporary debugging observations
- Anything you'd never need to recall in a future session

---

## Memory Quality Rules

1. **Specific** — `"openrouter requires .chat(modelId) not provider(modelId) — hits Responses API otherwise"` ✅ vs `"provider stuff"` ❌
2. **Self-contained** — readable without surrounding context
3. **Actionable** — a future session can act on it immediately
4. **Concise** — one fact per `save_knowledge` call
5. **Tagged** — always set `project: "forkscout"` for project-specific facts

---

## Task Lifecycle

```
Start work   → forkscout-mem__start_task (title + goal)
Mid-task win → forkscout-mem__save_knowledge (insight gained)
Task done    → forkscout-mem__complete_task (result summary)
```
