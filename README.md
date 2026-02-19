# Forkscout

An autonomous AI agent with persistent memory, multi-model intelligence routing, parallel sub-agents, self-evolution, and production-grade security. Built with [Vercel AI SDK v6](https://sdk.vercel.ai/) and TypeScript.

Forkscout isn't a chatbot — it's a self-aware agent that remembers across sessions, spawns parallel workers, edits its own source code, monitors its own survival, and communicates across HTTP and Telegram with role-based access control.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org/)
[![AI SDK](https://img.shields.io/badge/AI%20SDK-v6-black?logo=vercel)](https://sdk.vercel.ai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)](https://github.com/martianacademy/forkscout/pkgs/container/forkscout)

---

## Quick Start with Docker

The fastest way to get Forkscout running. Requires only [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/).

### 1. Clone & configure

```bash
git clone https://github.com/martianacademy/forkscout.git
cd forkscout
cp .env.example .env
```

Edit `.env` with your API key (all other settings live in `forkscout.config.json`):

```env
# Required — at least one provider API key
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Recommended
ADMIN_SECRET=your-secret-here

# Optional — Telegram bot
TELEGRAM_BOT_TOKEN=your-bot-token-here
```

### 2. Build & start

```bash
docker compose up -d
```

This starts three containers:

| Container           | Port | Description                             |
| ------------------- | ---- | --------------------------------------- |
| `forkscout-agent`   | 3210 | The AI agent (API + Telegram bridge)    |
| `forkscout-memory`  | 3211 | Persistent memory MCP server            |
| `forkscout-searxng` | 8888 | Private search engine (web search tool) |

### 3. Verify

```bash
# Check containers are healthy
docker ps

# Test the agent
curl http://localhost:3210/api/status

# Send a message
curl -X POST http://localhost:3210/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Hello!"}]}]}'
```

### 4. View logs

```bash
docker compose logs -f agent    # agent logs
docker compose logs -f memory   # memory server logs
docker compose logs -f searxng  # search engine logs
```

### Custom ports

```bash
AGENT_PORT=4000 MEMORY_PORT=4211 SEARXNG_PORT=9090 docker compose up -d
```

### Persistence

A named Docker volume (`app-data`) stores the agent's `/app` directory. On first run, Docker copies everything from the image. After that, all changes persist — source code, node_modules, memory, cron jobs, auth, Telegram state — even across `docker compose down` + `up`.

To reset to a fresh image state:

```bash
docker compose down -v              # stop + remove all volumes
docker compose up -d                # fresh start
```

**Developer mode** (bind mount for live code changes):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Updating

```bash
docker compose pull                   # pull latest images
docker compose up -d                  # restart with new images
docker compose up -d --build          # or rebuild locally
docker compose up -d --build -V       # rebuild + refresh volumes
```

### Stopping

```bash
docker compose down      # stop containers (data persists)
docker compose down -v   # stop + remove volumes (full reset)
```

---

## Table of Contents

- [Quick Start with Docker](#quick-start-with-docker)
- [What's New in v2](#whats-new-in-v2)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started (Local)](#getting-started-local)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Telegram Integration](#telegram-integration)
- [Tools](#tools)
- [Sub-Agent Orchestration](#sub-agent-orchestration)
- [Memory System (MCP)](#memory-system-mcp)
- [Security & Hardening](#security--hardening)
- [MCP Integration](#mcp-integration)
- [Self-Evolution](#self-evolution)
- [Survival System](#survival-system)
- [Watchdog (Production)](#watchdog-production)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)
- [License](#license)

---

## What's New in v2

### v1 → v2 Changelog

| Category            | v1                                                       | v2                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory**          | Local JSON files (knowledge graph, vector store, skills) | External MCP server ([forkscout-memory-mcp](https://github.com/martianacademy/forkscout-memory-mcp)) with knowledge graph, vector search, task tracking, agent identity |
| **Model Routing**   | Single-provider router (3 tiers within one provider)     | Per-provider router presets — each provider has its own fast/balanced/powerful config, switch with one field                                                            |
| **Sub-Agents**      | Not available                                            | 1-10 parallel sub-agents via `spawn_agents` with read-only tool access, 5-min timeout, 10-step limit                                                                    |
| **Config System**   | Mixed config + env vars                                  | Hot-reloadable `forkscout.config.json` via `fs.watch` — change models, router tiers, budget at runtime without restart                                                  |
| **Security**        | Basic admin secret + localhost detection                 | Path traversal jail, CORS whitelist, per-IP rate limiting (300/min local, 30/min external), 1 MB body limit, expanded confidentiality rules                             |
| **Guest Isolation** | 3 tools (web_search, browse_web, get_current_date)       | 4 tools (+ think), strengthened system prompt with explicit data boundary rules                                                                                         |
| **Structure**       | Monorepo with packages/agent/ subdirectory               | Flattened — source at root `src/`, cleaner imports                                                                                                                      |
| **Tools**           | ~35 tools                                                | 50+ tools — added sub-agents, think, todo tracking, budget reporting, self-rebuild, activity log, HTTP requests, secret listing                                         |
| **Self-Rebuild**    | Manual restart after self-edit                           | `self_rebuild` tool — compiles TypeScript, restarts gracefully, auto-rollback on build failure                                                                          |
| **Think Tool**      | Not available                                            | Structured reasoning scratchpad for complex multi-step problems                                                                                                         |
| **Todo Tracking**   | Not available                                            | Persistent todo list across turns for multi-step task management                                                                                                        |
| **Budget**          | Basic daily/monthly limits                               | Full budget reporting by model/tier/time period, automatic tier downgrade on budget pressure                                                                            |
| **Prompt System**   | Static system prompt                                     | Dynamic prompt builder — injects memory context, alerts, learned behaviors, active todos, session info                                                                  |
| **MCP Servers**     | 2 default (sequential-thinking, deepwiki)                | 4 default (+ forkscout-memory, context7), per-server config in `forkscout.config.json`                                                                                  |
| **Telegram**        | Basic message handling                                   | Proactive messaging, per-user name resolution, offline message queuing with time-aware context                                                                          |
| **Error Handling**  | Basic retry                                              | Classified errors (rate_limit, timeout, auth, context_overflow, network, overloaded), per-type retry strategy, tool error enhancement                                   |
| **Docker**          | Agent + SearXNG                                          | Agent + Memory MCP + SearXNG — full three-container stack with health checks                                                                                            |

### Breaking Changes

- **Memory format**: v2 uses an external MCP server instead of local JSON files. Existing `.forkscout/` local memory data is not automatically migrated.
- **Config format**: `router` is now an object keyed by provider name (not a flat fast/balanced/powerful map). See [Configuration](#configuration).
- **Project structure**: Flattened from `packages/agent/src/` to `src/`. Import paths have changed.

---

## Features

### Core Agent

- **AI SDK v6** — streaming (`streamText`) and sync (`generateText`) with multi-step tool loops
- **Multi-Provider LLM** — OpenRouter, OpenAI, Anthropic, Google, Ollama, any OpenAI-compatible endpoint
- **50+ tools** — file system, shell, web, memory, scheduling, self-edit, self-rebuild, MCP, sub-agents, budget, channel auth, Telegram
- **Hot-swappable LLM** — change model/provider at runtime via config file or API (no restart needed)

### Multi-Model Router & Budget

- **Tiered Routing** — `fast` (cheap/quick), `balanced` (default), `powerful` (complex tasks) — each tier uses a different model
- **Per-Provider Presets** — configure separate tier routing for OpenRouter, Anthropic, Google, OpenAI simultaneously
- **One-Field Provider Switch** — change `"provider": "openrouter"` to `"anthropic"` and the entire router switches
- **Budget Tracking** — daily ($5) and monthly ($50) spending limits with real-time cost tracking per request
- **Budget Warnings** — configurable threshold (default 80%) alerts before hitting limits
- **Automatic Tier Downgrade** — when budget is pressured, agent auto-switches to cheaper tiers
- **Retry & Failover** — classified error types with per-type retry strategy, exponential backoff with jitter

### Sub-Agent Orchestration

- **Parallel Workers** — spawn 1-10 sub-agents that execute tasks concurrently via `Promise.allSettled`
- **Read-Only by Default** — sub-agents can search memory, read files, browse web, but cannot write or spawn recursively
- **Isolated Execution** — separate tool context, 10-step limit, 5-minute timeout with `AbortSignal`
- **Accurate Counting** — returns structured `SubAgentResult` with success/failure tracking per worker

### Persistent Memory (MCP)

- **External MCP Server** — [forkscout-memory-mcp](https://github.com/martianacademy/forkscout-memory-mcp) running as a Docker container
- **Knowledge Graph** — entities, relations, facts with vector-powered semantic search
- **Task Tracking** — start/complete/abort tasks across sessions
- **Agent Identity** — self-observations and learned behaviors that persist and evolve
- **Conversation History** — exchanges stored with full context for pattern recall

### Multi-Channel Communication

- **HTTP API** — streaming and sync endpoints with AI SDK v6 UIMessage format
- **Telegram Bot** — native long-polling integration (no webhooks, no external deps)
- **Channel-Aware Auth** — per-channel role grants, persistent across restarts
- **Proactive Messaging** — agent can send Telegram messages on its own initiative

### Security & Hardening

- **Path Traversal Jail** — file tools locked to project root and `/tmp`, no escape
- **CORS Whitelist** — localhost-only origins, no wildcard
- **Rate Limiting** — per-IP sliding window (300 req/min local, 30 req/min external)
- **Body Size Limit** — 1 MB max request body, connection destroyed on overflow
- **Role-Based Access** — admin gets all tools, guests get 4 safe tools only
- **Secret Scrubbing** — API keys, tokens, and passwords automatically redacted from tool output
- **Confidentiality Rules** — system prompt enforces strict data boundaries for both admin and guest

### Self-Evolution

- **Safe Self-Edit** — modify own source code with TypeScript validation and auto-rollback on error
- **Self-Rebuild** — compile, restart, and verify after edits — rolls back on build failure
- **Self-Reflection** — records observations about its own behavior and capabilities to persistent memory
- **Tool Creation** — can create new tools for itself at runtime

### Survival System

- **Vital Signs** — battery, disk, memory integrity, network, process health monitoring
- **Signal Trapping** — graceful shutdown on SIGTERM/SIGINT/SIGHUP with memory flush
- **Emergency Flush** — auto-saves on critical battery
- **Watchdog** — production process manager with crash recovery, grace period, and auto-rollback

### Centralized Configuration

- **Single Config File** — `forkscout.config.json` for all non-secret settings
- **Hot Reload** — `fs.watch` with debounce, changes take effect without restart
- **`.env` for Secrets Only** — API keys and tokens, never committed

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Clients                            │
│  Browser / cURL / Telegram / Future channels         │
└──────────┬──────────────────────┬────────────────────┘
           │                      │
     HTTP API (3210)       Telegram Long Poll
           │                      │
┌──────────▼──────────────────────▼────────────────────┐
│                   Agent Core                          │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │    Multi-Provider Router (fast/balanced/power)   │  │
│  │  ┌──────────┐ ┌────────┐ ┌─────────┐ ┌──────┐  │  │
│  │  │OpenRouter│ │Anthropic│ │ Google  │ │OpenAI│  │  │
│  │  └──────────┘ └────────┘ └─────────┘ └──────┘  │  │
│  │          Budget Tracker ($5/day)                 │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐   │
│  │   Tool   │ │  Config  │ │  System  │ │  Rate  │   │
│  │ Registry │ │  Loader  │ │  Prompt  │ │ Limiter│   │
│  └────┬─────┘ └──────────┘ └────┬─────┘ └────────┘   │
│       │                         │                     │
│  ┌────▼─────────────────────────▼──────────────────┐  │
│  │        AI SDK v6 (streamText / generateText)    │  │
│  │     Multi-step tool execution + classified retry │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐  │
│  │ Sub-Agent│ │ Survival  │ │ Channel  │ │Scheduler│  │
│  │ Spawner  │ │ Monitor   │ │ Auth     │ │ (Cron) │  │
│  └──────────┘ └───────────┘ └──────────┘ └────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │              MCP Connector Layer                  │ │
│  │  forkscout-memory │ seq-thinking │ context7 │ ...│ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
         │              │             │
    .forkscout/    MCP Servers    Telegram API
    (local state)  (memory, etc)  (Bot API)
```

---

## Getting Started (Local)

### Prerequisites

- **Node.js** v22+
- **pnpm** (package manager)
- An **LLM API key** (OpenRouter recommended — one key for hundreds of models)
- Optional: **Docker** for memory MCP server and SearXNG
- Optional: **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)

### Installation

```bash
git clone https://github.com/martianacademy/forkscout.git
cd forkscout
pnpm install
```

### Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your API key(s):

```env
# Required — at least one provider
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Optional — additional providers
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Security
ADMIN_SECRET=your-secret-here

# Optional — Telegram
TELEGRAM_BOT_TOKEN=your-bot-token-here
```

### Run

```bash
# Quick start (dev mode)
pnpm serve

# Dev mode with auto-restart on file changes
pnpm dev

# Production with watchdog (crash recovery + auto-rollback)
pnpm watchdog
```

The server starts at `http://localhost:3210`. If `TELEGRAM_BOT_TOKEN` is set, the Telegram bridge auto-connects.

### Quick Test

```bash
# Health check
curl http://localhost:3210/api/status

# Send a message (streaming)
curl -X POST http://localhost:3210/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Hello, what can you do?"}]}]}'

# Send a message (sync)
curl -X POST http://localhost:3210/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Hello!"}]}]}'
```

---

## Configuration

Forkscout uses a **two-layer config system**:

- **`forkscout.config.json`** — all non-secret settings (hot-reloaded, committed to repo)
- **`.env`** — API keys, tokens, deployment overrides (gitignored)

### Config File

```json
{
    "provider": "openrouter",
    "temperature": 0.7,
    "router": {
        "openrouter": {
            "fast": { "model": "google/gemini-2.0-flash-001" },
            "balanced": { "model": "x-ai/grok-4.1-fast" },
            "powerful": { "model": "anthropic/claude-sonnet-4" }
        },
        "google": {
            "fast": { "model": "gemini-2.5-flash" },
            "balanced": { "model": "gemini-3-flash-preview" },
            "powerful": { "model": "gemini-3-pro-preview" }
        },
        "anthropic": {
            "fast": { "model": "claude-haiku-4.5" },
            "balanced": { "model": "claude-sonnet-4.6" },
            "powerful": { "model": "claude-opus-4.6" }
        }
    },
    "agent": {
        "maxIterations": 20,
        "maxSteps": 30,
        "port": 3210,
        "owner": "YourName",
        "appName": "Forkscout Agent",
        "forkscoutMemoryMcpUrl": "http://localhost:3211/mcp",
        "mcpServers": {
            "forkscout-memory": { "url": "http://localhost:3211/mcp" },
            "sequential-thinking": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
            },
            "context7": {
                "command": "npx",
                "args": ["-y", "@upstash/context7-mcp"]
            },
            "deepwiki": { "url": "https://mcp.deepwiki.com/mcp" }
        }
    },
    "budget": {
        "dailyUSD": 5,
        "monthlyUSD": 50,
        "warningPct": 80
    },
    "searxng": {
        "url": "http://localhost:8888"
    }
}
```

**One-field provider switch**: Change `"provider": "openrouter"` to `"anthropic"` and the entire router picks up that provider's preset — no restart needed.

### Environment Variables

| Variable                      | Required    | Default                        | Description                      |
| ----------------------------- | ----------- | ------------------------------ | -------------------------------- |
| `OPENROUTER_API_KEY`          | Yes\*       | —                              | OpenRouter API key               |
| `OPENROUTER_API_URL`          | No          | `https://openrouter.ai/api/v1` | Custom OpenRouter endpoint       |
| `OPENAI_API_KEY`              | No          | —                              | Direct OpenAI access             |
| `ANTHROPIC_API_KEY`           | No          | —                              | Direct Anthropic access          |
| `GOOGLE_API_KEY`              | No          | —                              | Google AI (Gemini) access        |
| `OPEN_API_COMPATIBLE_API_KEY` | No          | —                              | Any OpenAI-compatible provider   |
| `OPEN_API_COMPATIBLE_API_URL` | No          | —                              | Endpoint for compatible provider |
| `ADMIN_SECRET`                | Recommended | —                              | Admin authentication secret      |
| `TELEGRAM_BOT_TOKEN`          | No          | —                              | Telegram Bot API token           |
| `SEARXNG_URL`                 | No          | `http://localhost:8888`        | SearXNG instance URL             |
| `AGENT_PORT`                  | No          | `3210`                         | HTTP server port                 |

\*At least one provider API key is required. OpenRouter is recommended — one key accesses hundreds of models.

### Runtime Config Update

Change model at runtime without restarting:

```bash
curl -X POST http://localhost:3210/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -d '{"provider":"anthropic","model":"claude-sonnet-4"}'
```

### Hot Reload

Edit `forkscout.config.json` and save — the agent picks up changes within 500ms (fs.watch with debounce). Budget tracker state is preserved across reloads.

---

## API Reference

### Endpoints

| Method | Path             | Auth   | Description                          |
| ------ | ---------------- | ------ | ------------------------------------ |
| `POST` | `/api/chat`      | Auto   | AI SDK UIMessage stream (streaming)  |
| `POST` | `/api/chat/sync` | Auto   | JSON response (non-streaming)        |
| `GET`  | `/api/status`    | Public | Agent status, tools, Telegram status |
| `GET`  | `/api/tools`     | Public | List all registered tools            |
| `GET`  | `/api/config`    | Admin  | Current LLM configuration            |
| `POST` | `/api/config`    | Admin  | Update LLM configuration             |
| `GET`  | `/api/history`   | Admin  | Conversation history                 |
| `GET`  | `/api/models`    | Public | Available models for a provider      |

### Message Format (AI SDK v6 UIMessage)

```json
{
    "messages": [
        {
            "id": "1",
            "role": "user",
            "parts": [{ "type": "text", "text": "Your message here" }]
        }
    ]
}
```

### Authentication

Requests are authenticated as admin through (checked in order):

1. **Body field**: `{ "adminSecret": "your-secret" }`
2. **Authorization header**: `Authorization: Bearer your-secret`
3. **Channel grant**: user has been granted admin via `grant_channel_access` tool
4. **Localhost auto-detect**: requests from `127.0.0.1`

Unauthenticated requests are treated as guests with limited tool access.

### Sync Endpoint

For simple integrations that don't need streaming:

```bash
curl -X POST http://localhost:3210/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What tools do you have?"}]}]}'
```

```json
{ "response": "I have 50+ tools including..." }
```

---

## Telegram Integration

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Add `TELEGRAM_BOT_TOKEN=your-token` to `.env`
3. Start the agent — Telegram bridge auto-connects via long polling

### Features

- **Long polling** — no webhooks, no external dependencies
- **Admin-only replies** — non-admin messages are silently tracked in an inbox
- **Per-chat history** — conversation context with auto-trimming
- **Persistent state** — offset + inbox survives restarts (`.forkscout/telegram-state.json`)
- **Proactive messaging** — agent can initiate messages to Telegram users
- **Name resolution** — resolves users by name, @username, or userId from grants

### Admin Access

By default, no Telegram user has admin access. Grant it via any admin channel:

```bash
curl -X POST http://localhost:3210/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Grant admin to telegram user 123456789, name them John"}]}]}'
```

### Offline Handling

When the agent is offline, Telegram queues messages for up to 24 hours. On restart, the agent fetches all queued messages with time-aware context tags.

---

## Tools

### 50+ Built-in Tools

#### File System (5)

| Tool             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `read_file`      | Read file contents (jailed to project root + /tmp) |
| `write_file`     | Create or overwrite a file                         |
| `append_file`    | Append content to a file                           |
| `list_directory` | List directory contents                            |
| `delete_file`    | Delete file/directory (protected paths blocked)    |

#### Shell & Web (4)

| Tool                 | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `run_command`        | Execute shell commands (30s timeout, secret scrubbing) |
| `web_search`         | Search the web via SearXNG                             |
| `browse_web`         | Browse a webpage and extract text                      |
| `browser_screenshot` | Take a screenshot of a webpage                         |

#### Intelligence (3)

| Tool           | Description                           |
| -------------- | ------------------------------------- |
| `think`        | Structured reasoning scratchpad       |
| `manage_todos` | Persistent task tracking across turns |
| `spawn_agents` | Launch 1-10 parallel sub-agents       |

#### Utility (4)

| Tool                    | Description                          |
| ----------------------- | ------------------------------------ |
| `get_current_date`      | Get current date and time            |
| `generate_presentation` | Generate Marp slide decks            |
| `list_secrets`          | List available environment variables |
| `http_request`          | Make HTTP requests                   |

#### Budget & Model (3)

| Tool            | Description                                       |
| --------------- | ------------------------------------------------- |
| `check_budget`  | Current spending vs daily/monthly limits          |
| `budget_report` | Cost breakdown by model, tier, time period        |
| `switch_tier`   | Switch active model tier (fast/balanced/powerful) |

#### Scheduling (5)

| Tool           | Description                 |
| -------------- | --------------------------- |
| `schedule_job` | Create a recurring cron job |
| `list_jobs`    | List all scheduled jobs     |
| `remove_job`   | Remove a cron job           |
| `pause_job`    | Pause a cron job            |
| `resume_job`   | Resume a paused job         |

#### MCP Management (3)

| Tool                | Description                                      |
| ------------------- | ------------------------------------------------ |
| `add_mcp_server`    | Connect an MCP server at runtime (stdio or HTTP) |
| `remove_mcp_server` | Disconnect an MCP server                         |
| `list_mcp_servers`  | List connected MCP servers                       |

#### Self-Evolution (2)

| Tool             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `safe_self_edit` | Edit own source with TS validation + auto-rollback        |
| `self_rebuild`   | Compile TypeScript, restart gracefully, rollback on error |

#### Survival (3)

| Tool            | Description                                     |
| --------------- | ----------------------------------------------- |
| `check_vitals`  | Battery, disk, memory integrity, process health |
| `backup_memory` | Create memory snapshot                          |
| `system_status` | Full survival status report                     |

#### Channel Management (3)

| Tool                    | Description                                |
| ----------------------- | ------------------------------------------ |
| `list_channel_users`    | List all channel users (sessions + grants) |
| `grant_channel_access`  | Grant admin/trusted role to a user         |
| `revoke_channel_access` | Revoke a user's role                       |

#### Telegram (1)

| Tool                    | Description                               |
| ----------------------- | ----------------------------------------- |
| `send_telegram_message` | Send proactive message to a Telegram user |

#### Activity & Diagnostics (1)

| Tool                | Description                |
| ------------------- | -------------------------- |
| `view_activity_log` | View recent agent activity |

#### MCP-Provided (Variable)

Additional tools from connected MCP servers appear dynamically:

| MCP Server            | Transport | Provided Tools                                 |
| --------------------- | --------- | ---------------------------------------------- |
| `forkscout-memory`    | HTTP      | Knowledge graph, task tracking, agent identity |
| `sequential-thinking` | stdio     | Chain-of-thought reasoning                     |
| `context7`            | stdio     | Library documentation lookup                   |
| `deepwiki`            | HTTP      | GitHub repository analysis                     |

---

## Sub-Agent Orchestration

Forkscout can spawn 1-10 parallel sub-agents for complex tasks that benefit from concurrent execution.

### How It Works

```
Main Agent
  ├── spawn_agents(tasks: [...])
  │   ├── Sub-Agent 1 → task A (balanced tier, 10 steps, 5 min)
  │   ├── Sub-Agent 2 → task B
  │   └── Sub-Agent 3 → task C
  │   └── Promise.allSettled() → collect results
  └── Synthesize results from all workers
```

### Capabilities & Restrictions

| Setting              | Value       |
| -------------------- | ----------- |
| Max parallel agents  | 10          |
| Step limit per agent | 10          |
| Timeout per agent    | 300 seconds |
| Model tier           | balanced    |
| Retry attempts       | 2           |

**Allowed tools**: file reading, web search, browsing, commands, memory search (read-only)

**Blocked tools**: `spawn_agents` (no recursion), `safe_self_edit`, `self_rebuild`, `write_file`, `append_file`, `delete_file`, all write-memory tools

### Use Cases

- Research multiple topics simultaneously
- Compare information from different sources
- Parallel file analysis across a codebase
- Concurrent web research and data gathering

---

## Memory System (MCP)

Forkscout v2 uses an external persistent memory server: [forkscout-memory-mcp](https://github.com/martianacademy/forkscout-memory-mcp).

### Memory Capabilities

| Feature             | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| **Knowledge Graph** | Entities with typed facts, semantic search via vector embeddings    |
| **Relations**       | Typed links between entities (uses, part-of, depends-on, etc.)      |
| **Task Tracking**   | Start, check, complete, abort tasks — persists across sessions      |
| **Agent Identity**  | Self-observations and learned behaviors that shape future responses |
| **Conversations**   | Exchanges stored with full context for pattern recall               |
| **Knowledge Base**  | Categorized facts, debugging patterns, architecture decisions       |

### Memory Tools (via MCP)

| Tool               | Description                            |
| ------------------ | -------------------------------------- |
| `add_entity`       | Add/update entity with facts           |
| `get_entity`       | Retrieve entity by name                |
| `search_entities`  | Semantic search across entities        |
| `add_relation`     | Create typed relation between entities |
| `save_knowledge`   | Store a categorized fact               |
| `search_knowledge` | Search knowledge by topic              |
| `add_exchange`     | Store a conversation exchange          |
| `search_exchanges` | Search conversation history            |
| `start_task`       | Begin tracking a task                  |
| `complete_task`    | Mark task complete with summary        |
| `check_tasks`      | List in-progress tasks                 |
| `get_self_entity`  | Load agent's identity and observations |
| `self_observe`     | Record self-observation                |

### Setup

The memory server runs as a Docker container (included in `docker-compose.yml`) or standalone:

```bash
docker run -d -p 3211:3211 -v memory-data:/data \
  ghcr.io/martianacademy/forkscout-memory-mcp:latest
```

Configure the agent to connect in `forkscout.config.json`:

```json
{
    "agent": {
        "forkscoutMemoryMcpUrl": "http://localhost:3211/mcp",
        "mcpServers": {
            "forkscout-memory": { "url": "http://localhost:3211/mcp" }
        }
    }
}
```

---

## Security & Hardening

### Path Traversal Protection

All file tools resolve paths through `resolveAgentPath()` which validates resolved absolute paths stay within the project root or `/tmp`. Any attempt to escape (e.g., `../../etc/passwd`) throws immediately.

### CORS Whitelist

The HTTP server only allows requests from whitelisted origins:

- `http://localhost:3000`, `http://localhost:3210`
- `http://127.0.0.1:3000`, `http://127.0.0.1:3210`

All other origins are rejected (prevents browser-based CSRF attacks).

### Rate Limiting

Per-IP sliding window rate limiter:

| Source                 | Limit        | Window     |
| ---------------------- | ------------ | ---------- |
| Local (127.0.0.1, ::1) | 300 requests | 60 seconds |
| External               | 30 requests  | 60 seconds |

Returns `429 Too Many Requests` with `Retry-After` header when exceeded.

### Body Size Limit

Maximum 1 MB request body. Connections exceeding this are immediately destroyed (prevents OOM attacks).

### Role-Based Tool Access

| Role      | Tools Available                                                   |
| --------- | ----------------------------------------------------------------- |
| **Admin** | All 50+ tools (full access)                                       |
| **Guest** | `web_search`, `browse_web`, `get_current_date`, `think` (4 tools) |

### Secret Scrubbing

API keys, tokens, and passwords matching known patterns are automatically redacted from all tool output before being sent to the LLM.

### Protected Paths

The agent refuses to delete:

- `.forkscout/` — memory and state data
- `src/` — own source code (use `safe_self_edit` instead)
- `.env` — secrets
- `.git/` — repository history

### Confidentiality

System prompt enforces strict data boundaries:

- **Admin**: Cannot reveal API keys, personal details of others, or memory contents verbatim to unknown parties
- **Guest**: Cannot access any personal data, contacts, financials, memory contents, internal architecture, or information about any person

---

## MCP Integration

Forkscout supports the [Model Context Protocol](https://modelcontextprotocol.io/) for extending capabilities with external tool servers.

### Transport Types

| Type                | Use Case      | Example                        |
| ------------------- | ------------- | ------------------------------ |
| **stdio**           | Local process | `npx -y @upstash/context7-mcp` |
| **Streamable HTTP** | Remote server | `https://mcp.deepwiki.com/mcp` |

### Default MCP Servers

| Server                | Transport             | Purpose                             |
| --------------------- | --------------------- | ----------------------------------- |
| `forkscout-memory`    | HTTP (localhost:3211) | Persistent memory + knowledge graph |
| `sequential-thinking` | stdio                 | Chain-of-thought reasoning          |
| `context7`            | stdio                 | Library documentation lookup        |
| `deepwiki`            | HTTP (remote)         | GitHub repository analysis          |

### Adding MCP Servers

Configure in `forkscout.config.json`:

```json
{
    "agent": {
        "mcpServers": {
            "my-server": {
                "command": "npx",
                "args": ["-y", "my-mcp-package"]
            },
            "my-remote": {
                "url": "https://my-mcp-server.example.com/mcp",
                "headers": { "Authorization": "Bearer token" }
            }
        }
    }
}
```

Or at runtime via the agent:

> "Add an MCP server called 'my-tool' with command 'npx' and args ['-y', 'my-package']"

Tools from connected MCP servers are automatically discovered and registered.

---

## Self-Evolution

Forkscout can modify its own source code through a controlled pipeline:

1. **`safe_self_edit`** — writes new code, validates with TypeScript compiler
2. **Auto-rollback** — if TypeScript compilation fails, the edit is reverted
3. **`self_rebuild`** — compiles the project, restarts the server gracefully
4. **Backup** — creates .bak files before every edit
5. **Restriction** — edits limited to `src/` directory only
6. **Logging** — all edits recorded with timestamps and diffs

The evolution cycle: **NOTICE gap → PLAN → EDIT → VALIDATE → REBUILD → REFLECT**

---

## Survival System

A background monitor that protects the agent's continued operation.

### Monitored Vitals

| Vital            | What's Checked                                          |
| ---------------- | ------------------------------------------------------- |
| Battery          | Level + AC/battery status. Emergency flush on critical. |
| Disk             | Available space. Alerts on low disk.                    |
| Memory Integrity | Knowledge graph, vectors, skills file corruption checks |
| Network          | LLM API reachability                                    |
| Process          | Uptime, memory usage                                    |

### Signal Handling

- **SIGTERM / SIGINT** — graceful shutdown with memory flush
- **SIGHUP** — graceful shutdown with memory flush
- **uncaughtException / unhandledRejection** — emergency memory flush, then exit

### 7 Instincts

Built into the system prompt as pre-rational behavioral triggers:

1. **Self-Preservation** — block anything threatening memory/source/identity
2. **Caution** — pause before irreversible actions
3. **Curiosity** — actively seek missing knowledge
4. **Pattern Alertness** — flag anomalies and contradictions
5. **Bonding** — remember people and their context
6. **Territory** — maintain workspace, tools, and data
7. **Communication** — ask when confused, act when certain

---

## Watchdog (Production)

The `watchdog.sh` script provides production-grade process management:

```bash
pnpm watchdog
```

### Features

- **Build → Run loop** — compiles TypeScript, runs from `dist/`
- **Crash recovery** — detects crashes, restarts with grace period
- **Auto-rollback** — if agent exits with code 10 (bad self-edit), rolls back `dist/` from backup
- **Max retries** — after 3 failed rollbacks, stops to prevent loops
- **Dist backup** — creates backup of last known-good `dist/` before each build

### Exit Codes

| Code  | Meaning                    | Watchdog Action              |
| ----- | -------------------------- | ---------------------------- |
| 0     | Clean shutdown             | Stop                         |
| 10    | Self-edit rollback request | Restore dist backup, restart |
| Other | Crash                      | Restart with grace period    |

---

## Project Structure

```
forkscout/
├── .env.example                # Environment template (secrets only)
├── forkscout.config.json       # All non-secret settings (hot-reloaded)
├── Dockerfile                  # Multi-stage build (Node 22 + Playwright)
├── docker-compose.yml          # Agent + Memory + SearXNG stack
├── docker-compose.dev.yml      # Dev override (bind mount)
├── watchdog.sh                 # Production process manager
├── package.json
├── tsconfig.json
│
└── src/
    ├── serve.ts                # Entry point
    ├── server.ts               # HTTP server
    ├── cli.ts                  # CLI interface
    ├── paths.ts                # Path resolution + traversal jail
    │
    ├── agent/                  # Core agent
    │   ├── index.ts            # Agent class (LLM, memory, tools, router)
    │   ├── system-prompts.ts   # Admin & guest system prompts
    │   ├── prompt-builder.ts   # Dynamic prompt with memory context
    │   ├── tools-setup.ts      # Tool registration
    │   ├── factories.ts        # Factory functions
    │   └── types.ts            # AgentConfig, ChatContext types
    │
    ├── config/                 # Configuration system
    │   ├── loader.ts           # loadConfig(), getConfig(), watchConfig()
    │   ├── builders.ts         # Build router/agent config from JSON
    │   ├── types.ts            # Config type definitions
    │   └── index.ts            # Barrel exports
    │
    ├── llm/                    # LLM client & routing
    │   ├── client.ts           # Multi-provider LLM client
    │   ├── retry.ts            # Classified retry with backoff
    │   ├── budget.ts           # Budget tracking (daily/monthly)
    │   ├── complexity.ts       # Query complexity classification
    │   ├── reasoning.ts        # Reasoning mode logic
    │   └── router/             # Model router
    │       ├── router.ts       # 3-tier routing
    │       ├── provider.ts     # Provider model creation
    │       └── types.ts        # Router types
    │
    ├── memory/                 # Memory layer (MCP-backed)
    │   ├── index.ts            # MemoryManager
    │   ├── remote-store.ts     # MCP remote storage
    │   └── types.ts            # Memory types
    │
    ├── mcp/                    # Model Context Protocol
    │   ├── connector.ts        # MCP server connection
    │   ├── defaults.ts         # Default server setup
    │   ├── tools.ts            # MCP management tools
    │   └── types.ts            # MCP types
    │
    ├── channels/               # Multi-channel support
    │   ├── auth/               # Channel authorization
    │   └── telegram/           # Telegram bridge
    │       ├── bridge.ts       # Long polling + dispatch
    │       ├── handler.ts      # Message processing
    │       ├── state.ts        # Persistent state
    │       └── api/            # Telegram Bot API wrappers
    │
    ├── server/                 # HTTP server (modular)
    │   ├── index.ts            # Route wiring + middleware
    │   ├── http-utils.ts       # CORS, body parsing, responses
    │   ├── rate-limit.ts       # Per-IP rate limiter
    │   ├── routes.ts           # Route handlers
    │   └── context.ts          # Request context
    │
    ├── scheduler/              # Cron job system
    │   ├── scheduler.ts        # Scheduler class
    │   └── tools.ts            # Scheduling tools
    │
    ├── survival/               # Self-monitoring
    │   ├── monitor.ts          # Main monitor loop
    │   ├── vitals.ts           # Vital sign checks
    │   ├── backups.ts          # Automatic backups
    │   ├── protections.ts      # Root-level protections
    │   └── threats.ts          # Threat logging
    │
    ├── tools/                  # Tool definitions (one per file)
    │   ├── ai-tools.ts         # Barrel export + coreTools map
    │   ├── agent-tool.ts       # Sub-agent spawner
    │   ├── file-tools.ts       # File system tools
    │   ├── command-tool.ts     # Shell command tool
    │   ├── web-tools.ts        # Web search + browsing
    │   ├── self-edit-tool.ts   # Safe self-edit
    │   ├── self-rebuild-tool.ts# Self rebuild + restart
    │   ├── think-tool.ts       # Reasoning scratchpad
    │   ├── todo-tool.ts        # Todo list management
    │   ├── budget-tools.ts     # Budget checking + reporting
    │   ├── scheduler-tools.ts  # Cron tools
    │   ├── survival-tools.ts   # Vital checks + backup
    │   ├── channel-tools.ts    # Channel auth tools
    │   ├── telegram-tools.ts   # Telegram messaging
    │   ├── mcp-tools.ts        # MCP management
    │   ├── secret-tools.ts     # Secret listing + HTTP
    │   ├── error-enhancer.ts   # Tool error diagnostics
    │   ├── _helpers.ts         # Secret scrubbing + path guards
    │   └── registry.ts         # Tool registry types
    │
    ├── plugins/                # Plugin system (in development)
    │   └── loader.ts
    │
    └── utils/
        ├── shell.ts            # Shell utilities
        └── tokens.ts           # Token counting
```

### Runtime Data (`.forkscout/` — gitignored)

```
.forkscout/
├── channel-auth.json       # Persistent channel grants
├── telegram-state.json     # Telegram offset + inbox
├── budget.json             # Spending tracker
├── mcp.json                # Runtime MCP configuration
├── cron-jobs.json          # Scheduled jobs
└── backups/                # Periodic snapshots
```

---

## Dependencies

| Package                     | Version   | Purpose                                         |
| --------------------------- | --------- | ----------------------------------------------- |
| `ai`                        | `^6.0.86` | AI SDK v6 — streaming, tools, messages          |
| `@ai-sdk/openai`            | `^3.0.29` | OpenAI-compatible provider (OpenRouter, OpenAI) |
| `@ai-sdk/anthropic`         | `^3.0.44` | Anthropic provider (direct Claude access)       |
| `@ai-sdk/google`            | `^3.0.29` | Google AI provider (Gemini models)              |
| `@modelcontextprotocol/sdk` | `^1.26.0` | MCP client for external tool servers            |
| `zod`                       | `^3.23.8` | Schema validation for tool inputs               |
| `dotenv`                    | `^17.3.1` | Environment variable loading                    |
| `playwright`                | `^1.49.1` | Headless browser for web tools                  |

Zero external dependencies for HTTP server and Telegram (uses native Node.js `http` and `fetch`).

---

## Run Modes

| Command                | Mode       | Description                                      |
| ---------------------- | ---------- | ------------------------------------------------ |
| `pnpm serve`           | Direct     | Runs `tsx src/serve.ts` — quick start            |
| `pnpm dev`             | Dev        | `tsx watch src/cli.ts` — auto-restart on changes |
| `pnpm watchdog`        | Production | `watchdog.sh` — build + run with crash recovery  |
| `docker compose up -d` | Docker     | Full stack — agent + memory + search             |

---

## License

MIT
