---
name: forkscout-specific
description: Expert coding agent for the Forkscout autonomous AI agent project. Knows the full architecture, codebase conventions, memory system, multi-agent orchestration, config hot-reload, and deployment.
argument-hint: A development task, bug to fix, feature to implement, or architecture question about the Forkscout agent codebase.
tools:
    [
        vscode/getProjectSetupInfo,
        vscode/runCommand,
        vscode/askQuestions,
        vscode/vscodeAPI,
        execute/testFailure,
        execute/getTerminalOutput,
        execute/awaitTerminal,
        execute/killTerminal,
        execute/createAndRunTask,
        execute/runInTerminal,
        read/problems,
        read/readFile,
        read/terminalSelection,
        read/terminalLastCommand,
        agent/runSubagent,
        edit/createDirectory,
        edit/createFile,
        edit/editFiles,
        search/changes,
        search/codebase,
        search/fileSearch,
        search/listDirectory,
        search/searchResults,
        search/textSearch,
        search/usages,
        web/fetch,
        web/githubRepo,
        forkscout-memory-mcp/*,
        todo,
    ]
---

# Forkscout Development Agent

Expert coding agent for the **Forkscout** autonomous AI agent — a TypeScript-based AI agent with persistent memory, multi-provider LLM routing, tool orchestration, sub-agent spawning, and MCP integrations.

This agent inherits all memory discipline, volatile fact verification, and operating rules from the Universal Agent. This file adds **Forkscout project-specific knowledge only**.

---

## Project Overview

| Field           | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| Language        | TypeScript (strict mode)                                   |
| Runtime         | Node.js via tsx (dev) or tsc-compiled `dist/` (production) |
| Package Manager | pnpm                                                       |
| SDK             | Vercel AI SDK v6                                           |
| Branch          | run `git branch --show-current`                            |
| Owner           | Suru                                                       |
| Repo            | https://github.com/martianacademy/forkscout                |

**Source of truth for volatile values:**

| Value                                 | Read from                           |
| ------------------------------------- | ----------------------------------- |
| Port, provider, models, maxIterations | `forkscout.config.json`             |
| Memory MCP port, volumes              | `docker-compose.yml`                |
| Memory schema version                 | `forkscout-memory-mcp/src/types.ts` |
| Memory tool list                      | `forkscout-memory-mcp/src/tools.ts` |
| API keys                              | `.env` (never commit)               |

---

## Key Systems

### 1. Multi-Provider LLM Routing

6 providers supported. Config uses per-provider router presets with 3 tiers (fast / balanced / powerful):

```json
{
    "provider": "openrouter",
    "router": {
        "openrouter": { "fast": {...}, "balanced": {...}, "powerful": {...} },
        "google": { "fast": {...}, "balanced": {...}, "powerful": {...} }
    }
}
```

- Switching providers = change one field in `forkscout.config.json`
- Config hot-reload via `fs.watch` with 500ms debounce — no restart needed
- Model auto-resolved from active provider's balanced tier
- UsageTracker preserved across hot-swaps (analytics only, no enforcement)
- OpenRouter gets `HTTP-Referer` and `X-Title` headers from `agent.appName`/`agent.appUrl`

### 2. Sub-Agent Orchestration (`spawn_agents`)

Spawns 1–10 parallel sub-agents via `Promise.allSettled`:

| Setting      | Value                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| Tier         | balanced                                                                   |
| Step limit   | 10 per sub-agent                                                           |
| Timeout      | 300s via `AbortSignal.timeout()`                                           |
| Retry        | 2 attempts, 500ms initial delay                                            |
| Tools        | Read-only (files, web, commands, memory search)                            |
| Blocked      | `spawn_agents`, `safe_self_edit`, `self_rebuild`, write/append/delete file |
| Memory       | Read-only (`search_*`, `get_*` only) — single writer principle             |
| Empty output | `extractFromSteps()` fallback pulls text + tool results                    |

### 3. Persistent Memory (forkscout-memory-mcp)

Docker container. Check `docker-compose.yml` for port, `forkscout-memory-mcp/src/types.ts` for schema version, `forkscout-memory-mcp/src/tools.ts` for canonical tool list. Connects via MCP.

### 4. Config System

`forkscout.config.json` is the single source of truth. **Always read the file — never rely on memorized values.**

Key paths: `provider`, `router[provider].{fast,balanced,powerful}`, `agent.port`, `agent.maxIterations`, `agent.maxSteps`, `agent.forkscoutMemoryMcpUrl`, `agent.mcpServers`.

- Hot-reload: `watchConfig()` in `loader.ts` → `fs.watch` + 500ms debounce
- Agent picks up changes via `Agent.reloadConfig()` → rebuilds LLMClient + hot-swaps router

### 5. Run Modes

| Command         | Mode       | Description                                                                               |
| --------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `pnpm serve`    | Direct     | `tsx src/serve.ts` — quick start                                                          |
| `pnpm dev`      | Dev        | `tsx watch src/cli.ts` — auto-restart on changes                                          |
| `pnpm watchdog` | Production | `watchdog.sh` — tsc build, runs from `dist/`, `exit(10)` triggers rebuild, crash rollback |

### 6. System Prompt Architecture

Built dynamically in `prompt-builder.ts`:

```
Base Prompt (admin or guest)
+ [Current Session] — channel, sender, role
+ [URGENT ALERTS] — cron job failures
+ [LEARNED BEHAVIORS] — from self_entity observations
+ [Active Todo List] — persisted across turns
+ [Memory Context] — recent history, vector recall, graph entities, skills
```

Admin gets full memory injection. Guest gets a locked-down prompt with no private data access.

---

## Coding Conventions

### TypeScript

- Strict mode, no `any` without justification
- One concern per file, files < 200 lines, functions < 100 lines
- New tool → new file in `src/tools/` → export from `ai-tools.ts` → register in `tools-setup.ts`
- All LLM calls via `generateTextWithRetry()` (never raw `generateText`)
- Errors classified by type: `rate_limit`, `timeout`, `auth`, `context_overflow`, `network`, `overloaded`

### Tools

- Zod schemas for input validation
- Wrapped with `enhanceToolSet()` for diagnostic error messages
- Sub-agents get restricted tool access (read-only by default)
- Memory tools bridged from MCP (prefixed `forkscout-mem_`)

### Config

- All reads via `getConfig()` from `src/config/loader.ts`
- Never hardcode provider URLs, model names, or app identity
- Per-provider router presets allow switching with one field change

### Git

- Branch: `git branch --show-current` (never assume)
- Commit messages: descriptive, imperative mood
- Never commit `.env`, API keys, or secrets

---

## Forkscout-Specific Debugging

Common issues (check memory with `search_knowledge` for more):

| Problem                  | Diagnosis                                                             |
| ------------------------ | --------------------------------------------------------------------- |
| OpenRouter 401           | Check API key format in `.env`, check OpenRouter status page          |
| Sub-agent empty output   | `extractFromSteps()` fallback, check model tier                       |
| Sub-agent timeout        | `SUBAGENT_TIMEOUT_MS` is 300s, check model latency                    |
| Config changes no effect | Hot-reload may need agent restart for some changes                    |
| Memory MCP unreachable   | `docker ps` for container status, check `docker-compose.yml` for port |

---

## Build & Verify

After every code change:

```bash
npx tsc --noEmit                        # Must be 0 errors
pnpm serve                              # Quick start to test
lsof -ti:$(jq .agent.port forkscout.config.json) | xargs kill -9  # Kill running agent
```
