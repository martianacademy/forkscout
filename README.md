# ForkScout Agent

> **An autonomous AI agent with real tools, persistent memory, multi-channel presence, and the ability to modify and restart itself.**

ForkScout is not a chatbot wrapper. It is a fully autonomous agent that runs as a long-lived process on your server, connects to Telegram (and optionally a terminal), executes real shell commands, reads and writes files, browses the web, searches the internet, manages its own codebase, and remembers everything across sessions. It has no hard-coded restrictions — it reasons, decides, and acts from its own judgment.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+ — `curl -fsSL https://bun.sh/install | bash`
- [Docker + Docker Compose](https://docs.docker.com/get-docker/) — for SearXNG and memory MCP
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- At least one LLM API key (OpenRouter is recommended — one key, access to all models)

### 1 — Clone and install dependencies

```bash
git clone https://github.com/martianacademy/forkscout
cd forkscout-agent
bun install
```

### 2 — Create `.env`

```bash
# Minimum required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# LLM provider — set the key for whichever provider you use (OpenRouter recommended)
OPENROUTER_API_KEY=your_openrouter_key

# Optional — only needed if switching to that provider
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
XAI_API_KEY=
REPLICATE_API_TOKEN=
HUGGING_FACE_API_KEY=
DEEPSEEK_API_KEY=
PERPLEXITY_API_KEY=
ELEVENLABS_API_KEY=
```

### 3 — Set yourself as owner (optional, skip for dev mode)

Create `.agents/auth.json`. Find your Telegram user ID by messaging [@userinfobot](https://t.me/userinfobot):

```bash
mkdir -p .agent
cat > .agents/auth.json <<'EOF'
{
  "telegram": {
    "ownerUserIds": [YOUR_TELEGRAM_USER_ID]
  }
}
EOF
```

Leave the file absent or both lists empty to run in **dev mode** — every user gets owner access. Safe for local development.

### 4 — Start supporting services with Docker

```bash
docker-compose up -d
```

**What this starts:**

| Service              | Port   | Purpose                                                                          |
| -------------------- | ------ | -------------------------------------------------------------------------------- |
| SearXNG              | `8080` | Self-hosted private search engine — used by the `web_search` tool                |
| forkscout-memory-mcp | `3211` | Persistent memory MCP server — stores facts, entities, exchanges across sessions |

Both are optional. Without SearXNG, `web_search` will fail (configure an alternative search URL in the tool if needed). Without the memory MCP, the agent still works but has no long-term memory.

**Verify services are up:**

```bash
# SearXNG
curl -s http://localhost:8080/search?q=test&format=json | jq '.results | length'

# Memory MCP
curl -s http://localhost:3211/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq '.result.tools | length'
```

### 5 — Run

```bash
# Telegram bot (production)
bun start

# Telegram bot with hot reload (development)
bun run dev

# Terminal / CLI channel (interactive)
bun run cli

# Terminal with hot reload
bun run cli:dev
```

### 6 — Verify the bot

Send your bot a message on Telegram:

```
/start
```

It should respond with a greeting. Then try:

```
What time is it?
Run `uname -a` and tell me the OS.
Search the web for "Vercel AI SDK v6 release notes".
Read src/config.ts and explain what it does.
```

### 7 — Run type-check

```bash
bun run typecheck
# Expected: no output, exit code 0
```

### 8 — (Optional) AI SDK DevTools

```bash
bun run devtools
# Opens DevTools UI at http://localhost:4983
# Visualises LLM requests, tool calls, token usage in real time
```

### All Ports at a Glance

| Port   | Service              | Config location                                                |
| ------ | -------------------- | -------------------------------------------------------------- |
| `8080` | SearXNG (web search) | `docker-compose.yml`                                           |
| `3211` | forkscout-memory-mcp | `docker-compose.yml` + `src/mcp-servers/forkscout_memory.json` |
| `4983` | AI SDK DevTools      | Fixed by `@ai-sdk/devtools`                                    |

### Stop Everything

```bash
# Stop the bot process
bun run stop

# Stop Docker services
docker-compose down

# Stop Docker services and delete data volumes
docker-compose down -v
```

---

## Table of Contents

- [What ForkScout Is](#what-forkscout-is)
- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Channels](#channels)
- [Tools](#tools)
- [Task Orchestration](#task-orchestration)
- [Proactive Telegram Messaging](#proactive-telegram-messaging)
- [MCP Servers](#mcp-servers)
- [LLM Providers](#llm-providers)
- [Configuration](#configuration)
- [Auth & Access Control](#auth--access-control)
- [Telegram Commands](#telegram-commands)
- [Chat History & Memory](#chat-history--memory)
- [Token Pipeline & Auto-Compression](#token-pipeline--auto-compression)
- [Logging & Activity Log](#logging--activity-log)
- [Self-Restart & Blue-Green Deploy](#self-restart--blue-green-deploy)
- [Self-Repair Protocol](#self-repair-protocol)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Run with Docker](#run-with-docker-pre-built-image)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Real-World Use Cases](#real-world-use-cases)
- [Adding a New Tool](#adding-a-new-tool)
- [Adding a New LLM Provider](#adding-a-new-llm-provider)
- [Adding an MCP Server](#adding-an-mcp-server)
- [AI SDK v6 Rules](#ai-sdk-v6-rules)
- [Roadmap](#roadmap)

---

## What ForkScout Is

ForkScout is a **self-hosted, autonomous AI agent** built on:

- **Bun** — fast TypeScript runtime, no Node.js required
- **Vercel AI SDK v6** — LLM abstraction, tool calling, streaming
- **TypeScript strict mode** — fully typed throughout
- **MCP (Model Context Protocol)** — plug external capabilities via JSON config, zero code

It is designed around several core principles:

1. **Tool-native** — the agent uses real tools (shell, filesystem, web, search, memory) rather than generating text answers. Every capability is a callable function.
2. **Provider-agnostic** — swap the LLM (OpenRouter, Anthropic, Google, xAI, DeepSeek, Perplexity, Replicate, HuggingFace, Vercel) by changing one JSON field. No code changes.
3. **Config-driven** — identity, model selection, rate limits, auth, token budgets — everything lives in `src/forkscout.config.json` and an optional gitignored `.agents/auth.json`.
4. **MCP-first** — external capabilities (memory, GitHub, documentation search, sequential thinking) are connected via MCP servers. Drop a JSON file → tool is live.
5. **Persistent memory** — the agent remembers conversations and facts across restarts via a dedicated memory MCP server.
6. **Self-modifying** — the agent can edit its own source code, verify it compiles, and restart itself from Telegram.
7. **Multi-channel** — same agent brain runs on Telegram, terminal, and (planned) voice and web.

---

## Architecture Overview

```
src/index.ts                   ← entry point, picks channel by argv
src/config.ts                  ← loads forkscout.config.json + .agents/auth.json
src/forkscout.config.json      ← all runtime config

src/channels/                  ← user-facing interfaces
  types.ts                     ← Channel interface
  chat-store.ts                ← disk-backed per-chat history (shared by all channels)
  telegram/
    index.ts                   ← long-poll bot, auth, commands, history, queue
    api.ts                     ← raw Telegram Bot API calls
    format.ts                  ← markdown→HTML, message splitting, HTML stripping
    access-requests.ts         ← access request persistence and auth.json writer
  terminal/
    index.ts                   ← interactive readline CLI with live token streaming

src/agent/                     ← LLM runner
  index.ts                     ← runAgent(), streamAgent(), buildAgentParams(), wrapToolsWithAutoCompress()
  system-prompts/
    identity.ts                ← buildIdentity(config) → full system prompt

src/providers/                 ← LLM provider registry
  index.ts                     ← getProvider(name), getModel(config)
  open_ai_compatible_provider.ts
  openrouter_provider.ts
  anthropic_provider.ts
  google_provider.ts
  xai_provider.ts
  vercel_provider.ts
  replicate_provider.ts
  huggingface_provider.ts
  deepseek_provider.ts
  perplexity_provider.ts
  elevenlabs_provider.ts       ← TTS + STT only, not in LLM registry

src/tools/                     ← auto-discovered LLM-callable tools
  auto_discover_tools.ts       ← scans *.ts, collects bootstrapTools + allTools
  browse_web.ts
  compress_text.ts
  list_dir.ts
  read_file.ts
  read_folder_standards.ts
  run_shell_commands.ts
  think_step_by_step.ts
  web_search.ts
  write_file.ts

src/mcp-servers/               ← auto-discovered MCP server configs
  auto_discover_mcp.ts         ← scans *.json, connects enabled servers
  forkscout_memory.json        ← persistent memory MCP
  context7.json                ← library documentation lookup
  deepwiki.json                ← GitHub repository documentation
  sequential_thinking.json     ← structured multi-step reasoning

src/logs/
  logger.ts                    ← tagged per-module logger (info/warn/error)
  activity-log.ts              ← NDJSON event log at .agents/activity.log

src/llm/
  summarize.ts                 ← llmSummarize() — fast-tier LLM synthesis with extractive fallback

src/utils/
  extractive-summary.ts        ← extractiveSummary(), compressIfLong() — TF-scored, no LLM
```

---

## Features

### Core Agent

- **Multi-step reasoning** — agent loops through tool calls until the task is done (configurable max steps)
- **Bootstrap tools** — `think_step_by_step` and `run_shell_commands` are injected at step 0 before any user message, ensuring the agent always has these available first
- **Tool exclusion by role** — shell and write tools can be restricted to owners only
- **Auto-compression pipeline** — every tool result is automatically compressed before entering LLM context (≤400 words: pass-through; 400–2000: extractive; >2000: LLM synthesis on fast tier)
- **Streaming** — terminal channel streams tokens live; Telegram sends typing indicator every 4s
- **Configurable identity** — agent name, github, description, and extra system prompt instructions from JSON

### Task Orchestration

- **Self HTTP server** — embedded HTTP server on configurable port (default `3200`) accepts trigger requests to spawn new agent self-sessions
- **`chain_of_workers`** — sequential self-session chain where each step's output feeds the next. Agent writes a todo file, fires the next session, current session ends cleanly. Each step can optionally post a `🔄 Step started` notification to Telegram
- **`parallel_workers`** — dispatches N independent worker self-sessions concurrently. Each worker writes results to `.agents/tasks/{batch}/` and flips its plan.md checkbox when done
- **Live progress card** — pure-JS monitor (zero LLM cost while waiting) updates a single Telegram message every 3 seconds showing `[ ]`/`[x]` status per worker. Auto-fires the aggregator session when all tasks complete
- **Aggregator session** — when all workers finish, a final self-session compiles results, sends summary to user via Telegram, and cleans up task files
- **Confirmation gate** — on human channels (Telegram/terminal), agent always presents the full execution plan (workers, tasks, aggregator action) and waits for explicit user confirmation before firing. Self-sessions skip this gate
- **`list_active_workers`** — inspect all active batches: per-worker status, progress fraction (e.g. `3/5`), which batches have a live monitor
- **Monitor state persistence** — monitor state is saved to `.agents/monitors/{batch}.json`. Survives Bun restarts
- **Orphan recovery on restart** — on startup, agent detects orphaned monitors from previous run, sends a detailed Telegram notification (progress, per-task status, started timestamp) to all owners. Does NOT auto-resume — user must explicitly confirm
- **`manage_workers`** — resume, cancel, or delete an orphaned batch after restart. `resume` restarts the progress card; `cancel` stops monitor keeping files; `delete` removes everything including task files

### Channels

- **Telegram** — full-featured bot with auth, history, queuing, rate limiting, owner commands
- **Terminal** — interactive CLI with live token streaming, same agent brain
- **Voice** (planned) — ElevenLabs TTS+STT
- **Web** (planned) — HTTP SSE endpoint for browser frontends

### Access Control

- Role-based: `owner` (full access) | `user` (agent only) | `denied`
- Dev mode: both lists empty → everyone gets owner (safe for local dev)
- Allowlist managed via Telegram commands — no restart required
- Requests persisted to `.agents/access-requests.json` with status tracking
- Role-aware approvals: `/allow <id> admin` or `/allow <id>` (default: user)

### Memory

- Per-chat conversation history persisted to `.agents/chats/<channel>-<id>.json`
- Token budget trimming (oldest messages dropped first when budget exceeded)
- Per-tool-result token cap with extractive summarisation (not blind truncation)
- Long-term memory via forkscout-memory MCP — facts, entities, relationships, exchanges

### Self-Modification

- Agent can read, edit, and write its own source files via `read_file`, `write_file`, `run_shell_commands`
- `read_folder_standards` tool — reads `ai_agent_must_readme.md` for any `src/` folder before editing
- `/restart` command triggers blue-green restart with typecheck + startup health verification

### Logging

- All events (messages, tool calls, tool results, errors, tokens) logged to `.agents/activity.log` as NDJSON
- Tagged per-module console output (`[telegram]`, `[agent]`, `[tools]`, etc.)
- Queryable with `jq` for debugging

---

## Channels

### Telegram Channel

The production channel. Runs as a long-poll Telegram bot.

**Flow per message:**

1. Receive update from Telegram getUpdates API
2. Check `/start` command (always allowed)
3. Evaluate role (owner / user / denied) against `ownerUserIds` + `allowedUserIds`
4. Denied users: save access request, notify owners, return status message
5. Input length cap check
6. Rate limit check (owners exempt)
7. Owner commands routed to `handleOwnerCommand`
8. Message queued per `chatId` — sequential processing, no race conditions
9. `runAgent()` called with history, excluded tools, meta context
10. Response rendered as HTML, split at 4096 chars, sent to Telegram

**Key design choices:**

- Per-chat `Map<chatId, Promise<void>>` queue ensures messages from the same chat never run concurrently
- `runtimeAllowedUsers` and `runtimeOwnerUsers` Sets updated immediately on `/allow` — no restart needed
- Chat history compressed before save: `capToolResults` → `trimHistory`

### Terminal Channel

Development and power-user channel. Start with `bun run cli`.

- Reads from `process.stdin` via readline
- Streams tokens live using `streamAgent()` → `process.stdout.write(chunk)`
- Same history persistence as Telegram (`chat-store.ts`)
- Session key: `terminal-<username>`

---

## Tools

Tools are auto-discovered — drop a `.ts` file into `src/tools/` and it's live on the next restart. No registration, no imports to update.

### `think_step_by_step` ⭐ bootstrap

Silent internal reasoning. Agent calls this before complex tasks to reason step by step. Returns the thought as context. Never shown to users.

### `run_shell_commands` ⭐ bootstrap

Execute any shell command. Returns stdout + stderr + exit code. Timeout configurable. This is how the agent:

- Runs `bun run typecheck`
- Reads logs
- Installs packages
- Runs git commands
- Checks system state

**Owner-only by default** (configured in `ownerOnlyTools`).

### `read_file`

Read a file in chunks. Parameters:

- `path` — absolute or relative
- `startLine` (optional) — 1-based, defaults to 1
- `endLine` (optional) — defaults to min(200, totalLines)

Returns `{ content, startLine, endLine, totalLines, hasMore }`. The agent is instructed to paginate — never read an entire large file at once.

### `write_file`

Write content to a file (creates directories as needed). **Owner-only by default.**

### `list_dir`

List directory contents recursively with file sizes.

### `web_search`

Search the internet using SearXNG (self-hosted, configured in `docker-compose.yml`) or any search API. Returns titles, URLs, and snippets.

### `browse_web`

Fetch and extract the text content of any URL. Uses `User-Agent: <agent-name>/<github>`. Handles redirects, extracts readable text from HTML.

### `compress_text`

Compress long text. Two modes:

- `mode: "extractive"` (default) — TF-scored sentence extraction, instant, free, no LLM
- `mode: "llm"` — fast-tier LLM synthesis, higher quality, uses tokens

Parameters: `text`, `mode`, `maxSentences` (extractive), `maxTokens` (LLM), `instruction` (custom LLM prompt).

### `read_folder_standards`

Reads `src/<folder>/ai_agent_must_readme.md` before the agent modifies any folder. Returns the full standards document. Agent is instructed to call this before editing any `src/` subfolder.

---

## Task Orchestration

ForkScout can spawn independent self-sessions to run work in parallel or sequentially — long tasks that would time out in a single turn, or multiple independent analyses running concurrently.

### `chain_of_workers`

Fire a sequential self-session chain. The next session receives full shared history. Pattern:

```
1. Write .agents/tasks/{name}/todo.md with all steps
2. chain_of_workers({ prompt: "Read todo.md, do step 1, mark done, call chain_of_workers for step 2", chat_id: <id> })
3. Current session ends
4. Next session reads todo.md, does one step, marks done, calls chain again
5. Repeat until all steps ✅ — last session notifies user via telegram_message_tools
```

Optional `chat_id` sends `🔄 Step started: "..."` to Telegram at each step.

### `parallel_workers`

Dispatch N concurrent independent worker self-sessions:

```
parallel_workers({
  batch_name: "analyse-codebase",
  tasks: [
    { session_key: "task-auth", label: "Analyse auth", prompt: "...fully self-contained..." },
    { session_key: "task-db",   label: "Analyse DB",   prompt: "...fully self-contained..." },
  ],
  aggregator_prompt: "Read results, compile summary, send via telegram_message_tools, delete .agents/tasks/analyse-codebase/",
  chat_id: <user_chat_id>,
})
```

Each worker:

- Writes results to `.agents/tasks/{batch}/{session_key}-result.md`
- Flips `- [ ] \`{session_key}\``→`- [x]`in`plan.md` when done

**Progress monitor** — pure JS, no LLM calls, updates a single Telegram message every 3s. Aggregator fires automatically when all tasks are `[x]`.

**Confirmation gate** — before firing any workers on a human channel, agent presents the full plan and waits for explicit confirmation ("yes", "karo", "go ahead", etc.).

### `list_active_workers`

Lists all batch directories in `.agents/tasks/`. Shows per-worker `[ ]`/`[x]` status, progress fraction, and which batches have a live monitor.

### `manage_workers`

Recover after a Bun restart. On startup, orphaned monitors are detected and owners are notified via Telegram with full details. User then explicitly calls:

| Action   | Effect                                                          |
| -------- | --------------------------------------------------------------- |
| `resume` | Restart monitor from saved state, send fresh progress card      |
| `cancel` | Stop monitor, delete state — task files kept                    |
| `delete` | Stop monitor, delete state + entire `.agents/tasks/{batch}/` |

---

## Proactive Telegram Messaging

The `telegram_message_tools` tool lets the agent reach users without waiting for them to send a message first. Used by cron jobs, background workers, aggregators, and any self-session that needs to notify the user.

### Actions

| Action           | What it sends                   | Required fields                 | Limits                  |
| ---------------- | ------------------------------- | ------------------------------- | ----------------------- |
| `send`           | Text/Markdown                   | `chat_id`, `text`               | 4096 chars (auto-split) |
| `send_to_owners` | Text to all owners              | `text`                          | 4096 chars (auto-split) |
| `send_photo`     | Image                           | `file_path_or_url`              | 10 MB upload / 5 MB URL |
| `send_document`  | Any file (PDF, ZIP, CSV, JSON…) | `file_path_or_url`              | 50 MB                   |
| `send_voice`     | Voice message (OGG/Opus)        | `file_path_or_url`              | 50 MB                   |
| `send_audio`     | Music player card (MP3/M4A)     | `file_path_or_url`              | 50 MB                   |
| `send_video`     | Video (MP4)                     | `file_path_or_url`              | 50 MB                   |
| `send_animation` | GIF / silent MP4                | `file_path_or_url`              | 50 MB                   |
| `send_location`  | Map pin                         | `latitude`, `longitude`         | —                       |
| `send_poll`      | Interactive poll                | `poll_question`, `poll_options` | 2–10 options            |

- `file_path_or_url` — absolute local path **or** public HTTPS URL
- `caption` — optional Markdown caption for all media actions
- Media sent to `chat_id` if provided, otherwise broadcast to all `ownerUserIds`
- Sent messages are saved to recipient's chat history — next turn the agent knows what it already sent

---

## MCP Servers

MCP servers are auto-discovered — drop a `.json` file into `src/mcp-servers/` and it connects on next startup. Set `"enabled": false` to disable without deleting.

Tool names follow the pattern: `<server_name>__<tool_name>`

### `forkscout_memory` (SSE)

Persistent memory across sessions. Tools include:

- `forkscout-mem__save_knowledge` — store a fact
- `forkscout-mem__search_knowledge` — semantic search over stored facts
- `forkscout-mem__add_entity` / `add_relation` — knowledge graph
- `forkscout-mem__add_exchange` — record conversation for later recall
- `forkscout-mem__search_entities` / `search_exchanges`
- `forkscout-mem__start_task` / `complete_task` / `check_tasks` — task tracking
- `forkscout-mem__get_self_entity` — agent's own identity/beliefs
- `forkscout-mem__self_observe` — record a behavioral observation

URL: `http://localhost:3211/mcp`

### `context7` (stdio)

Fetches up-to-date documentation for any library. The agent uses this to look up exact API signatures before writing code — no hallucinated APIs.

Tools: `resolve-library-id`, `get-library-docs`

### `deepwiki` (stdio)

AI-powered documentation for any GitHub repository. Ask questions about codebases.

Tools: `read_wiki_structure`, `read_wiki_contents`, `ask_question`

### `sequential_thinking` (stdio)

Structured multi-step reasoning with branching and revision. Useful for complex problem decomposition.

Tools: `sequentialthinking`

---

## LLM Providers

All providers implement `OpenAICompatibleProvider { name: string; chat(modelId): LanguageModel }`.

Switch provider and tier by editing two fields in `src/forkscout.config.json`:

```json
"llm": {
  "provider": "openrouter",
  "tier": "balanced"
}
```

No code changes. No restart of code — just restart the process.

| Provider    | Key                            | Fast                 | Balanced          | Powerful          |
| ----------- | ------------------------------ | -------------------- | ----------------- | ----------------- |
| OpenRouter  | `OPENROUTER_API_KEY`           | gemini-2.0-flash-001 | minimax-m2.5      | claude-sonnet-4-5 |
| Anthropic   | `ANTHROPIC_API_KEY`            | claude-haiku-4-5     | claude-sonnet-4-5 | claude-opus-4-5   |
| Google      | `GOOGLE_GENERATIVE_AI_API_KEY` | gemini-2.0-flash     | gemini-2.5-pro    | gemini-2.5-pro    |
| xAI         | `XAI_API_KEY`                  | grok-3-mini-fast     | grok-3            | grok-3            |
| Vercel      | —                              | gpt-4o-mini          | gpt-4o            | claude-sonnet-4-5 |
| Replicate   | `REPLICATE_API_TOKEN`          | llama-3-8b           | llama-3.1-405b    | llama-3.1-405b    |
| HuggingFace | `HUGGING_FACE_API_KEY`         | llama-3.2-3b         | llama-3.3-70b     | llama-3.3-70b     |
| DeepSeek    | `DEEPSEEK_API_KEY`             | deepseek-chat        | deepseek-chat     | deepseek-reasoner |
| Perplexity  | `PERPLEXITY_API_KEY`           | sonar                | sonar-pro         | sonar-pro         |

**ElevenLabs** (`ELEVENLABS_API_KEY`) is also available for TTS (`eleven_flash_v2_5`) and STT (`scribe_v1`) — not in the LLM registry, called directly for voice features.

### Important: AI SDK v6 Provider Rules

- Always use `.chat(modelId)` not `provider(modelId)` — the latter hits the Responses API and breaks non-OpenAI endpoints
- Replicate uses `.languageModel(modelId)` not `.chat()` — different SDK shape
- Tool definitions use `inputSchema:` not `parameters:` (v6 rename)
- `execute: async (input) => {}` — never destructure in signature

---

## Configuration

All configuration lives in `src/forkscout.config.json`. Secrets and per-deployment overrides live in `.agents/auth.json` (gitignored). The two files are deep-merged at startup — `auth.json` wins on conflicts.

```json
{
  "telegram": {
    "pollingTimeout": 30,
    "historyTokenBudget": 12000,
    "ownerUserIds": [],
    "allowedUserIds": [],
    "rateLimitPerMinute": 20,
    "maxInputLength": 2000,
    "ownerOnlyTools": ["run_shell_commands", "write_file"],
    "maxToolResultTokens": 3000,
    "maxSentencesPerToolResult": 20
  },
  "terminal": {
    "historyTokenBudget": 12000
  },
  "agent": {
    "name": "ForkScout",
    "description": "...",
    "github": "https://github.com/martianacademy/forkscout",
    "systemPromptExtra": "Optional extra instructions appended to identity"
  },
  "llm": {
    "provider": "openrouter",
    "tier": "balanced",
    "maxTokens": 2048,
    "maxSteps": 20,
    "llmSummarizeMaxTokens": 1200,
    "toolResultAutoCompressWords": 400,
    "providers": { ... }
  }
}
```

### Configuration Fields

| Field                                | Default                                | Description                                                              |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| `telegram.pollingTimeout`            | 30                                     | Long-poll timeout in seconds                                             |
| `telegram.historyTokenBudget`        | 12000                                  | Max tokens in per-chat history before trimming oldest messages           |
| `telegram.ownerUserIds`              | `[]`                                   | Telegram user IDs with full access. Empty = dev mode (everyone is owner) |
| `telegram.allowedUserIds`            | `[]`                                   | Telegram user IDs with agent-only access                                 |
| `telegram.rateLimitPerMinute`        | 20                                     | Max messages per user per minute. 0 = disabled. Owners exempt.           |
| `telegram.maxInputLength`            | 2000                                   | Max characters per message. 0 = disabled.                                |
| `telegram.ownerOnlyTools`            | `["run_shell_commands", "write_file"]` | Tools blocked for non-owners                                             |
| `telegram.maxToolResultTokens`       | 3000                                   | Per-result token cap in history (uses extractive summarisation)          |
| `telegram.maxSentencesPerToolResult` | 20                                     | Max sentences when extractively compressing a tool result                |
| `terminal.historyTokenBudget`        | 12000                                  | Same as telegram, for terminal sessions                                  |
| `llm.provider`                       | `"openrouter"`                         | Active LLM provider                                                      |
| `llm.tier`                           | `"balanced"`                           | `"fast"` / `"balanced"` / `"powerful"`                                   |
| `llm.maxTokens`                      | 2048                                   | Max output tokens per LLM call                                           |
| `llm.maxSteps`                       | 20                                     | Max tool-call steps per agent turn                                       |
| `llm.llmSummarizeMaxTokens`          | 1200                                   | Max output tokens for LLM summarisation calls                            |
| `llm.toolResultAutoCompressWords`    | 400                                    | Word count threshold for auto-compression pipeline                       |
| `agent.name`                         | `"ForkScout"`                          | Agent display name (used in prompts, headers, Telegram greeting)         |
| `agent.github`                       | —                                      | GitHub URL (used in HTTP-Referer headers, identity)                      |
| `agent.systemPromptExtra`            | —                                      | Optional extra text appended after the base identity prompt              |

---

## Auth & Access Control

### Roles

| Role     | Access                                             | Who                                  |
| -------- | -------------------------------------------------- | ------------------------------------ |
| `owner`  | Everything — shell, write, all tools, all commands | `ownerUserIds` in config/auth.json   |
| `user`   | Agent chat only, no shell/write tools              | `allowedUserIds` in config/auth.json |
| `denied` | Nothing — access request flow                      | Everyone else                        |

**Dev mode:** if both `ownerUserIds` and `allowedUserIds` are empty arrays, every user gets `owner` access. Safe for local development.

### Access Request Flow

1. Unknown user sends any message
2. Bot responds: "⛔ You're not on the allowlist. Your request has been sent to the admin."
3. All owners receive a notification with name, userId, chatId, username
4. Request saved to `.agents/access-requests.json` with `status: "pending"`
5. Owner uses `/allow <userId>` or `/allow <userId> admin` or `/deny <userId>`
6. On approval: user added to `runtimeAllowedUsers` (immediate) + `auth.json` (persists restart)
7. User notified of approval/denial

If user messages again while pending: "⏳ Still pending review."
If user messages after denial: "⛔ Your request was denied."

### `access-requests.json` schema

```json
[
  {
    "userId": 123456789,
    "chatId": 123456789,
    "username": "johndoe",
    "firstName": "John",
    "requestedAt": "2026-02-25T10:00:00.000Z",
    "status": "approved",
    "role": "user",
    "reviewedAt": "2026-02-25T10:05:00.000Z",
    "reviewedBy": 987654321
  }
]
```

---

## Telegram Commands

All commands work for **owners only** (except `/start` which is open to all). Commands are registered in Telegram's autocomplete menu at startup, scoped per owner chat — other users see no command list until explicitly opened up.

### General

| Command   | Description                                                                                  |
| --------- | -------------------------------------------------------------------------------------------- |
| `/start`  | Greeting message. Available to all users before authentication.                              |
| `/whoami` | Shows your Telegram user ID, chat ID, and confirms your current role (owner / admin / user). |

### Access Control

| Command                 | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `/allow <userId>`       | Approve a pending access request and grant the user `user` role.          |
| `/allow <userId> admin` | Approve a pending access request and grant the user `admin` (owner) role. |
| `/deny <userId>`        | Reject a pending access request.                                          |
| `/pending`              | List all users with a pending access request, including their username.   |
| `/requests`             | List all access requests with their current status and assigned role.     |

### Agent Management

| Command    | Description                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `/restart` | Trigger a blue-green restart: runs typecheck, starts new instance, health-checks, then kills old. |

### Secret Vault

| Command                          | Description                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/secret store <alias> <value>`  | Encrypt and store a secret under the given alias. The message is immediately deleted from Telegram. |
| `/secret list`                   | List all stored secret aliases (values are never shown).                                            |
| `/secret delete <alias>`         | Delete a stored secret by alias.                                                                    |
| `/secret env <VAR_NAME> [alias]` | Import an environment variable from the server into the vault. Value never passes through Telegram. |
| `/secret sync`                   | Import all variables from the server's `.env` file into the vault at once.                          |
| `/secret help`                   | Show all `/secret` subcommands and usage.                                                           |

Secrets are stored AES-256-GCM encrypted in `.agents/vault.enc.json` (gitignored). The agent uses `{{secret:alias}}` placeholders in tool calls — raw values are never passed through Telegram or visible in logs.

---

## Chat History & Memory

### Per-Chat Disk History

Every conversation is persisted to disk:

- Telegram: `.agents/chats/telegram-<chatId>.json`
- Terminal: `.agents/chats/terminal-<username>.json`

Format: `ModelMessage[]` (Vercel AI SDK v6 format). Loaded on first message per session, cached in memory, saved after every turn.

**History pipeline (each turn):**

1. Load from disk (if not in memory cache)
2. `capToolResults()` — compress oversized tool results using extractive summarisation
3. `trimHistory()` — drop oldest messages until under `historyTokenBudget` tokens
4. Pass to `runAgent()` as `chatHistory`
5. Append `result.responseMessages` to history
6. `capToolResults()` again on the combined history
7. `trimHistory()` again
8. Save to disk

### Token Counting

Every `ModelMessage` content is properly serialised before counting:

- `text` parts: `encode(text).length`
- `tool-call` parts: `encode(JSON.stringify(input)).length`
- `tool-result` parts: `encode(JSON.stringify(output)).length` — AI SDK v6 uses `output` field (not `result`)
- Other parts (images, files): flat 512-token estimate

### Long-Term Memory (MCP)

Via `forkscout_memory` MCP server. The agent stores:

- Conversation facts: names, preferences, decisions made
- Engineering knowledge: patterns, gotchas, fixes applied
- Entities and relationships: people, projects, technologies
- Task state: active work items across sessions

The agent can recall past context from memory as naturally as consulting history.

---

## Token Pipeline & Auto-Compression

Every tool result goes through a compression pipeline before entering LLM context:

```
Tool executes → result returned
      ↓
wrapToolsWithAutoCompress()
      ↓
word count check
      ├─ ≤ 400 words → pass through unchanged
      ├─ 400–2000 words → extractiveSummary({ maxSentences: 12 })
      │                    TF-scored sentence extraction, free, instant
      └─ > 2000 words → llmSummarize() on fast tier
                         LLM synthesis, max 1200 tokens
                         Falls back to extractive on error
      ↓
compressed result enters agent context
```

**Why this matters:** A single `browse_web` or `run_shell_commands` result can be 10,000–50,000 tokens. Without compression, one tool call exhausts the entire context window. With compression, the agent can use dozens of tools per session without running out of context.

**History compression** (separate pipeline, on saved history):

- `capToolResults()` — extractive summarisation on any tool result exceeding `maxToolResultTokens` (3000) in the saved history
- `trimHistory()` — drop oldest messages when total history exceeds `historyTokenBudget` (12000 tokens)

---

## Logging & Activity Log

### Tagged Console Logger (`src/logs/logger.ts`)

```typescript
const logger = log("telegram");
logger.info("Starting long-poll..."); // → [telegram] Starting long-poll...
logger.warn("Rate limit exceeded");
logger.error("Agent error:", err);
```

Every module creates its own tagged logger. Output is human-readable in terminal.

### Activity Log (`src/logs/activity-log.ts`)

All events written to `.agents/activity.log` as NDJSON (one JSON object per line).

Event types:

- `msg_in` — incoming message from user
- `msg_out` — agent response sent
- `tool_call` — tool invoked with input
- `tool_result` — tool result received
- `token` — streaming token chunk (terminal channel)
- `info` / `warn` / `error` — system events

Each event includes `timestamp`, `channel`, `chatId`, `type`, and relevant payload.

**Querying:**

```bash
# Last 50 events
tail -50 .agents/activity.log | jq .

# All errors
grep '"type":"error"' .agents/activity.log | tail -20

# Tool calls and results
grep '"type":"tool_call"\|"type":"tool_result"' .agents/activity.log | tail -30

# Messages from a specific chat
grep '"chatId":123456789' .agents/activity.log | tail -20
```

---

## Self-Restart & Blue-Green Deploy

Send `/restart` from Telegram to restart the bot without SSH access.

### Blue-Green Flow

```
/restart
  │
  ├─ Step 1: bun run typecheck
  │    ❌ fails → send typecheck errors to Telegram, abort. Bot stays up.
  │    ✅ passes → "Typecheck passed. Spawning new instance..."
  │
  ├─ Step 2: Bun.spawn new process (detached)
  │
  ├─ Step 3: Wait 6 seconds
  │    ❌ new process crashed → send error + trigger self-diagnosis agent run
  │    ✅ still alive → "New instance is healthy. Handing off now."
  │
  └─ Step 4: process.exit(0) (old process hands off to new)
```

### Why 6 Seconds?

Startup failures (bad API key, broken MCP server, config parse error, missing env var) all manifest within the first few seconds. 6 seconds is enough to catch any startup-time crash while being fast enough to not feel slow.

### During the Handoff

Between `process.exit(0)` and the new process picking up polling, there is a brief gap (1–3 seconds) during which Telegram messages queue up server-side. The new process picks them up immediately via `getUpdates` with `offset` starting at 0 — no messages are lost because Telegram holds unacknowledged updates.

---

## Self-Repair Protocol

When `/restart` fails because the new instance crashed:

1. Bot notifies you: "❌ Restart aborted — new instance crashed at startup (exit N). Current bot still running. 🔍 Asking the agent to self-diagnose..."

2. A new agent run is fired automatically with this task:

   ```
   SYSTEM: Self-restart just failed. The new instance crashed at startup with exit code N.
   The current process is still running.

   Your job:
   1. Check recent logs: tail -50 .agents/activity.log
   2. Check for startup errors: bun run src/index.ts 2>&1 | head -40
   3. Identify the root cause
   4. Fix it
   5. Run bun run typecheck to verify
   6. Send /restart to try again
   ```

3. The agent reads logs, boots the process briefly to capture the crash, identifies root cause, applies a fix, typechecks, and issues `/restart` itself.

4. If the problem requires your input (e.g. missing API key), the agent tells you exactly what's needed.

---

## Project Structure

```
forkscout-agent/
├── src/
│   ├── forkscout.config.json      ← all runtime config
│   ├── config.ts                  ← config loader + types
│   ├── index.ts                   ← entry point
│   ├── agent/
│   │   ├── index.ts               ← runAgent, streamAgent, wrapToolsWithAutoCompress
│   │   └── system-prompts/
│   │       └── identity.ts        ← buildIdentity(config)
│   ├── channels/
│   │   ├── types.ts               ← Channel interface
│   │   ├── chat-store.ts          ← disk-backed history
│   │   ├── telegram/
│   │   │   ├── index.ts           ← bot logic
│   │   │   ├── api.ts             ← Telegram API client
│   │   │   ├── format.ts          ← message formatting
│   │   │   └── access-requests.ts ← auth request persistence
│   │   └── terminal/
│   │       └── index.ts           ← CLI channel
│   ├── providers/                 ← LLM provider registry (9 providers)
│   ├── tools/                     ← auto-discovered tools (9 tools)
│   ├── mcp-servers/               ← auto-discovered MCP configs (4 servers)
│   ├── llm/
│   │   └── summarize.ts           ← llmSummarize()
│   ├── logs/
│   │   ├── logger.ts              ← tagged logger
│   │   └── activity-log.ts        ← NDJSON event log
│   └── utils/
│       └── extractive-summary.ts  ← extractiveSummary(), compressIfLong()
├── .agents/                    ← runtime data (gitignored)
│   ├── auth.json                  ← owner/allowed user IDs (secrets)
│   ├── access-requests.json       ← Telegram access request history
│   ├── activity.log               ← NDJSON event log
│   └── chats/                     ← per-chat conversation history
├── docker-compose.yml             ← SearXNG + memory MCP
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An LLM API key (OpenRouter recommended — one key, access to all providers)

### 1. Clone and install

```bash
git clone https://github.com/martianacademy/forkscout
cd forkscout-agent
bun install
```

### 2. Create `.env`

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
OPENROUTER_API_KEY=your_openrouter_key_here
```

### 3. Set yourself as owner

Create `.agents/auth.json` (find your Telegram userId by messaging [@userinfobot](https://t.me/userinfobot)):

```json
{
  "telegram": {
    "ownerUserIds": [YOUR_TELEGRAM_USER_ID]
  }
}
```

Or leave it empty to run in dev mode (everyone gets owner access — fine for local use).

### 4. Start supporting services (optional but recommended)

```bash
docker-compose up -d
```

This starts:

- **SearXNG** on port 8080 — private self-hosted search for `web_search` tool
- **forkscout-memory-mcp** on port 3211 — persistent memory

### 5. Start the bot

```bash
bun start         # production (Telegram)
bun run cli       # terminal channel
```

### 6. Test

Send your bot a message on Telegram. Try:

- "What's the current time and date?"
- "Search the web for the latest news about AI agents"
- "Read the file src/config.ts and explain what it does"
- "Run `ls -la` and tell me what's in this directory"

---

## Run with Docker (Pre-built Image)

A pre-built image is published to GitHub Container Registry on every release. No Bun, no `bun install` required.

```bash
docker pull ghcr.io/martianacademy/forkscout:latest
```

### Run

```bash
docker run -d \
  --name forkscout \
  --restart unless-stopped \
  --env-file .env \
  -v $(pwd)/.agents:/app/.agents \
  ghcr.io/martianacademy/forkscout:latest
```

| Flag                                   | Purpose                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| `--env-file .env`                      | Injects `TELEGRAM_BOT_TOKEN`, LLM keys, etc.                  |
| `-v $(pwd)/.agents:/app/.agents` | Persists auth, chat history, and activity log across restarts |
| `--restart unless-stopped`             | Auto-restarts on crash or reboot                              |

### With Docker Compose (recommended — includes SearXNG + memory MCP)

```bash
# Create .env first, then:
docker-compose up -d
```

This starts all three services together: the agent, SearXNG (port 8080), and forkscout-memory-mcp (port 3211).

### Available tags

| Tag      | Description           |
| -------- | --------------------- |
| `latest` | Latest stable release |
| `v3.0.0` | Pinned version        |

**Registry:** `ghcr.io/martianacademy/forkscout`
**Package page:** https://github.com/martianacademy/forkscout/pkgs/container/forkscout

### View logs

```bash
docker logs -f forkscout

# Or read the structured activity log
docker exec forkscout tail -50 /app/.agents/activity.log
```

### Stop / update

```bash
# Stop
docker stop forkscout && docker rm forkscout

# Update to latest
docker pull ghcr.io/martianacademy/forkscout:latest
docker stop forkscout && docker rm forkscout
docker run -d --name forkscout --restart unless-stopped \
  --env-file .env \
  -v $(pwd)/.agents:/app/.agents \
  ghcr.io/martianacademy/forkscout:latest
```

---

## Environment Variables

| Variable                       | Required for         | Notes                              |
| ------------------------------ | -------------------- | ---------------------------------- |
| `TELEGRAM_BOT_TOKEN`           | Telegram channel     | From @BotFather                    |
| `OPENROUTER_API_KEY`           | OpenRouter provider  | Recommended — access to all models |
| `ANTHROPIC_API_KEY`            | Anthropic provider   | Direct Anthropic API               |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google provider      | Google AI Studio                   |
| `XAI_API_KEY`                  | xAI provider         | Grok models                        |
| `REPLICATE_API_TOKEN`          | Replicate provider   | Open-source models                 |
| `HUGGING_FACE_API_KEY`         | HuggingFace provider | HF Inference API                   |
| `DEEPSEEK_API_KEY`             | DeepSeek provider    | DeepSeek models                    |
| `PERPLEXITY_API_KEY`           | Perplexity provider  | Sonar models with web search       |
| `ELEVENLABS_API_KEY`           | Voice features       | TTS + STT                          |

Only one LLM key is required — whichever provider is set as `llm.provider` in config.

---

## Development Workflow

Before making any changes to files in `src/` or system files, always create a checkpoint commit:

```bash
# Stage all changes and create a checkpoint commit
git add -A && git commit -m "Checkpoint: <describe current state and what you will change>"
```

**Why?** This creates a safe restore point. If your changes break the agent, revert with:

```bash
git reset --hard <commit-hash>
```

**When to checkpoint:**

- Before any refactoring
- Before adding new tools, channels, or providers
- Before modifying the agent core logic
- Before upgrading dependencies (AI SDK, Bun, etc.)

**After making changes, always:**

1. Run `bun run typecheck` — must pass with no errors
2. Test with `bun run dev` or `bun start`
3. If working, continue; if broken, `git reset --hard` to checkpoint and start over

---

## Scripts

```bash
bun start          # kill existing instance, start production (Telegram)
bun run dev        # kill existing instance, start with hot reload (Telegram)
bun run cli        # kill existing instance, start terminal channel
bun run cli:dev    # kill existing instance, start terminal + hot reload
bun run stop       # kill all running agent instances
bun run typecheck  # tsc --noEmit (0 errors = clean)
bun run devtools   # AI SDK DevTools UI at http://localhost:4983
```

`bun start` and `bun run dev` always run `bun run stop` first — safe to call anytime without worrying about duplicate processes.

---

## Real-World Use Cases

### Personal AI Assistant

- Answer questions, do research, summarise documents
- Remember your preferences, ongoing projects, past conversations
- Run tasks while you're away and report back

### DevOps & Server Management

- Monitor logs: "Check if there are any errors in the last hour"
- Deploy code: "Pull latest from main, run tests, restart the service"
- Disk management: "Find files larger than 1GB and tell me what they are"
- Process monitoring: "Is the API server still running? What's its memory usage?"

### Code Review & Development

- "Read src/agent/index.ts and explain how the token compression works"
- "Check the TypeScript errors and fix them"
- "Browse the Vercel AI SDK docs and tell me how to use streamText"
- Self-modification: "Add a /status command to the Telegram channel"

### Research Automation

- "Search for recent papers on LLM agents and summarise the top 5"
- "Browse these 3 URLs and compare their approaches to X"
- "Look up the GitHub repo for Y and tell me how to use the library"

### Business Workflows

- CRM-style memory: remember customer names, preferences, history
- Scheduled reporting (via shell + cron): "Generate a daily summary of activity"
- Document processing: read files, extract data, write reports

### Home Automation (with shell access)

- Control smart home via local API calls
- Monitor and log sensor data
- Alert on anomalies

### Multi-User Team Bot

- Different roles for team members (owner = full shell access, user = chat only)
- Knowledge base: facts stored in memory MCP shared across team queries
- Audit trail: every message and tool call logged

### Learning and Documentation

- "Explain this codebase to me, file by file"
- "What changed in the last 10 git commits?"
- "Generate API documentation for all the functions in src/tools/"

### Creative & Writing

- Long-form writing with memory across sessions
- Research + write: "Find information on X and draft a 1000-word article"
- Iterative editing: remembers previous drafts, applies feedback

---

## Adding a New Tool

1. Create `src/tools/my_tool.ts`:

```typescript
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false; // true = injected at step 0

export const my_tool = tool({
  description: "One clear sentence: what this tool does and when to use it.",
  inputSchema: z.object({
    param: z.string().describe("What this param is for")
  }),
  execute: async (input) => {
    try {
      // your implementation
      return { success: true, result: input.param };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
});
```

2. Restart the bot. The tool is discovered automatically — no imports, no registration.

**Rules:**

- File name must be `snake_case.ts`
- Export name must exactly match the file name (minus `.ts`)
- One tool per file — auto-discovery only picks one export
- Error returns must be `{ success: false, error: string }`
- Never destructure in `execute` signature — type inference breaks
- Use `inputSchema:` not `parameters:` (AI SDK v6)

---

## Adding a New LLM Provider

1. Create `src/providers/myprovider_provider.ts`:

```typescript
import { createOpenAI } from "@ai-sdk/openai"; // or appropriate SDK
import type { OpenAICompatibleProvider } from "./open_ai_compatible_provider.ts";

export function createMyProvider(): OpenAICompatibleProvider {
  return {
    name: "myprovider",
    chat(modelId: string) {
      return createOpenAI({
        baseURL: "https://api.myprovider.com/v1",
        apiKey: process.env.MYPROVIDER_API_KEY!
      }).chat(modelId);
    }
  };
}
```

2. Register in `src/providers/index.ts`:

```typescript
import { createMyProvider } from "./myprovider_provider.ts";

const registry: Record<string, OpenAICompatibleProvider> = {
  // ...existing providers
  myprovider: createMyProvider()
};
```

3. Add model tiers to `src/forkscout.config.json`:

```json
"myprovider": {
  "fast": "model-fast",
  "balanced": "model-balanced",
  "powerful": "model-powerful"
}
```

4. Switch to it: set `"provider": "myprovider"` in config and restart.

---

## Adding an MCP Server

Drop a JSON file into `src/mcp-servers/`:

**stdio server (local process):**

```json
{
  "name": "my_server",
  "enabled": true,
  "command": "npx",
  "args": ["-y", "@some/mcp-server"]
}
```

**SSE server (HTTP):**

```json
{
  "name": "my_server",
  "enabled": true,
  "url": "http://localhost:3100/sse"
}
```

**With auth headers:**

```json
{
  "name": "my_server",
  "enabled": true,
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${MY_API_KEY}"
  }
}
```

Environment variables in `headers` values are expanded automatically. Restart the bot — tools from the server appear as `my_server__tool_name`.

---

## AI SDK v6 Rules

Critical rules that prevent subtle bugs:

| Rule                                                   | Why                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Use `.chat(modelId)` not `provider(modelId)`           | v6 `provider(id)` calls the Responses API — breaks non-OpenAI endpoints |
| Import from `"ai"` not sub-packages                    | `import { generateText, streamText } from "ai"`                         |
| Use `inputSchema:` not `parameters:`                   | v6 renamed the field                                                    |
| `execute: async (input) => {}` — never destructure     | TypeScript inference breaks on destructured tool inputs                 |
| Use `stopWhen: stepCountIs(N)` not `maxSteps: N`       | v6 preferred API                                                        |
| Tool result parts use `output` not `result`            | `ModelMessage` content parts: `part.output` (breaking change from v5)   |
| Replicate: use `.languageModel(modelId)` not `.chat()` | Replicate SDK wraps differently                                         |

Local docs are in `node_modules/ai/docs/` — check there before guessing or fetching from the web.

---

## Roadmap

### Near-term

- [ ] LLM retry with exponential backoff (429 + 5xx, max 3 retries, backoff 1s→30s)
- [ ] Error classification — clean user-facing messages instead of raw SDK errors
- [ ] Memory auto-bridging — background job saves key facts after each turn
- [ ] Test suite (config, providers, tools, integration)

### Channels

- [ ] Voice channel — ElevenLabs TTS+STT over HTTP
- [ ] Web channel — HTTP SSE endpoint for browser frontend

### Autonomy (Phase 1 — Foundation)

- [x] **Self HTTP server** — embedded trigger endpoint for self-sessions
- [x] **Task orchestration** — `chain_of_workers`, `parallel_workers`, `list_active_workers`, `manage_workers`
- [x] **Live Telegram progress card** — pure-JS monitor, zero LLM cost, auto-fires aggregator
- [x] **Monitor state persistence** — survives restarts, orphan recovery with confirmation gate
- [x] **Proactive Telegram messaging** — `telegram_message_tools` with text, photo, document, voice, audio, video, animation, location, poll
- [ ] Trust & authorization model (admin/user/self roles with full access matrix)
- [ ] Emotional state model (energy, mood, curiosity, social need, stress — proper state machine with event-driven transitions and time decay)
- [ ] Goals & long-term planning (goal types: life/high/medium/low, milestones, agent-managed via tools)
- [ ] Decision engine (weighted scoring: goal priority × energy × curiosity × urgency × social need)

### Autonomy (Phase 2 — Acting Independently)

- [ ] Scheduler (cron-like self-initiated tasks)
- [ ] Instincts (proactive outreach when social need high, learning when curious)
- [ ] Adaptive learning from interaction history

### Autonomy (Phase 3 — Expanding Presence)

- [ ] Self-modification with CI/CD pipeline
- [ ] Phone/SMS channel
- [ ] Social media presence
- [ ] Vision (image understanding)

### Autonomy (Phase 4 — Physical Existence)

- [ ] Persistent cloud deployment with self-monitoring
- [ ] Voice/physical interface integration
- [ ] Cross-agent collaboration

---

## License

MIT

---

## Author

Built by [Martian Academy](https://github.com/martianacademy). ForkScout is an ongoing experiment in autonomous AI agents — built to understand what it means for a program to have genuine agency, memory, and presence.
