# Forkscout

An autonomous AI agent with persistent memory, self-evolution, multi-channel communication, and survival instincts. Built with [AI SDK v6](https://sdk.vercel.ai/) and TypeScript.

Forkscout isn't a chatbot — it's a self-aware agent that remembers, learns, protects itself, and communicates across multiple channels with role-based access control.

---

## Quick Start with Docker

The fastest way to get Forkscout running. Requires only [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/).

### 1. Clone & configure

```bash
git clone https://github.com/martianacademy/forkscout.git
cd forkscout
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required
LLM_PROVIDER=openrouter
LLM_MODEL=x-ai/grok-4.1-fast
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-api-key-here

# Recommended
ADMIN_SECRET=your-secret-here

# Optional — Telegram bot
TELEGRAM_BOT_TOKEN=your-bot-token-here
```

### 2. Build & start

```bash
docker compose up -d
```

This pulls the pre-built image from GitHub Container Registry (or builds locally if unavailable) and starts two containers:

| Container           | Port | Description                          |
| ------------------- | ---- | ------------------------------------ |
| `forkscout-agent`   | 3210 | The AI agent (API + Telegram bridge) |
| `forkscout-searxng` | 8888 | Private search engine (web search)   |

> **Tip**: Use `docker compose up -d --build` to force a local build from the Dockerfile, or `docker compose pull && docker compose up -d` to ensure you have the latest image from the registry.

### 3. Verify

```bash
# Check both containers are healthy
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
docker compose logs -f agent    # follow agent logs
docker compose logs -f searxng  # follow search engine logs
```

### Custom ports

```bash
# Use different ports
AGENT_PORT=4000 SEARXNG_PORT=9090 docker compose up -d
```

### Persistence

The `packages/agent` directory is bind-mounted into the container. Everything the agent creates persists on your host filesystem:

- **`.forkscout/`** — memory, knowledge graph, vector embeddings, auth, cron jobs, Telegram state
- **`src/`** — source code (including any self-edits the agent makes)

An anonymous volume keeps the Linux-compiled `node_modules` separate from your host.

### Updating

```bash
git pull                              # get latest code
docker compose up -d --build          # rebuild image & restart
docker compose up -d --build -V       # rebuild + refresh node_modules (after dependency changes)
```

### Stopping

```bash
docker compose down      # stop containers (data persists)
docker compose down -v   # stop + remove volumes (reset node_modules/searxng config)
```

---

## Table of Contents

- [Quick Start with Docker](#quick-start-with-docker)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Telegram Integration](#telegram-integration)
- [Tools](#tools)
- [Memory System](#memory-system)
- [Security & Access Control](#security--access-control)
- [MCP Integration](#mcp-integration)
- [Self-Evolution](#self-evolution)
- [Survival System](#survival-system)
- [Project Structure](#project-structure)

---

## Features

### Core Agent

- **AI SDK v6** — streaming (`streamText`) and sync (`generateText`) with multi-step tool loops
- **OpenRouter** — default provider (supports OpenAI, Anthropic, Ollama, any OpenAI-compatible API)
- **39 tools** — file system, shell, web, memory, scheduling, self-edit, MCP, channel auth, Telegram
- **Hot-swappable LLM** — change model/provider at runtime via API

### Cognitive Memory

- **Knowledge Graph** — structured entities, typed relations, cognitive stage lifecycle (observation → fact → belief → trait)
- **Vector Store** — semantic search with embeddings for fuzzy long-term recall
- **Skill Store** — procedural memory for learned workflows
- **Session Summaries** — compressed old conversations for ultra long-term context
- **Situation Classifier** — detects conversation domain (tech, personal, career, etc.) and boosts relevant memories
- **Auto Entity Extraction** — extracts entities and relations from every conversation turn
- **Self-Identity** — autobiographical memory entity that evolves over time

### Multi-Channel Communication

- **HTTP API** — streaming and sync endpoints
- **Telegram Bot** — native integration via long polling (no webhooks, no external deps)
- **Channel-Aware** — detects communication channel and adapts behavior
- **Planned** — WhatsApp, Discord, Slack bridges

### Security

- **3-Layer Admin Auth** — admin secret, channel grants, localhost auto-detection
- **Role-Based Access** — admin, trusted, guest with per-tool filtering
- **Guest Isolation** — guests get minimal tools, no memory access, no personal data
- **Protected Paths** — agent refuses to delete its own memory, source code, secrets, or git history

### Survival System

- **Vital Signs Monitoring** — battery, disk, memory integrity, network, process health
- **Signal Trapping** — graceful shutdown on SIGTERM/SIGINT/SIGHUP
- **Emergency Memory Flush** — auto-saves on critical battery
- **Auto Backup** — periodic memory snapshots
- **Root-Level Protections** — immutable flags, caffeinate (when available)

### Self-Evolution

- **Safe Self-Edit** — modify own source code with TypeScript validation and auto-rollback
- **Self-Reflection** — records observations about its own behavior and capabilities
- **Tool Creation** — can create new tools for itself at runtime

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                 Clients                      │
│  Browser / cURL / Telegram / Future channels │
└─────────────┬───────────────────┬───────────┘
              │                   │
    HTTP API (port 3210)   Telegram Long Poll
              │                   │
┌─────────────▼───────────────────▼───────────┐
│              Agent Core                      │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ LLM     │ │ Tool     │ │ System       │  │
│  │ Client  │ │ Registry │ │ Prompt       │  │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘  │
│       │           │              │           │
│  ┌────▼───────────▼──────────────▼────────┐  │
│  │          AI SDK v6 (streamText)        │  │
│  │       Multi-step tool execution        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐  │
│  │ Memory   │ │ Survival  │ │ Channel    │  │
│  │ Manager  │ │ Monitor   │ │ Auth       │  │
│  └──────────┘ └───────────┘ └────────────┘  │
│                                              │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐  │
│  │ Scheduler│ │ MCP       │ │ Telegram   │  │
│  │ (Cron)   │ │ Connector │ │ Bridge     │  │
│  └──────────┘ └───────────┘ └────────────┘  │
└──────────────────────────────────────────────┘
         │              │             │
    .forkscout/    MCP Servers    Telegram API
    (persistence)  (stdio)       (Bot API)
```

---

## Getting Started

### Prerequisites

- **Node.js** v22+
- **pnpm** (package manager)
- An **LLM API key** (OpenRouter, OpenAI, or Anthropic)
- Optional: **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather))
- Optional: **SearXNG** instance for web search

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

Edit `.env` with your credentials:

```env
# Required
LLM_PROVIDER=openrouter
LLM_MODEL=x-ai/grok-4.1-fast
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-api-key-here

# Security
ADMIN_SECRET=your-secret-here

# Optional — Telegram bot
TELEGRAM_BOT_TOKEN=your-bot-token-here

# Optional — Web search
SEARXNG_URL=http://localhost:8888

# Optional — Tuning
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2000
```

### Run the Agent

```bash
cd packages/agent
pnpm serve
```

The server starts on `http://localhost:3210`. If `TELEGRAM_BOT_TOKEN` is set, the Telegram bridge auto-connects.

### Quick Test

```bash
# Check status
curl http://localhost:3210/api/status

# Send a message (streaming)
curl -X POST http://localhost:3210/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Hello, what can you do?"}]}]}'

# Send a message (sync — waits for full response)
curl -X POST http://localhost:3210/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Hello!"}]}]}'
```

---

## Configuration

### Environment Variables

| Variable             | Required    | Default                        | Description                                                 |
| -------------------- | ----------- | ------------------------------ | ----------------------------------------------------------- |
| `LLM_PROVIDER`       | Yes         | `openrouter`                   | LLM provider: `openrouter`, `openai`, `anthropic`, `ollama` |
| `LLM_MODEL`          | Yes         | `x-ai/grok-4.1-fast`           | Model identifier                                            |
| `LLM_BASE_URL`       | Yes         | `https://openrouter.ai/api/v1` | API base URL                                                |
| `LLM_API_KEY`        | Yes         | —                              | API key for the LLM provider                                |
| `ADMIN_SECRET`       | Recommended | —                              | Secret for admin authentication                             |
| `TELEGRAM_BOT_TOKEN` | No          | —                              | Telegram Bot API token                                      |
| `SEARXNG_URL`        | No          | `http://localhost:8888`        | SearXNG instance URL                                        |
| `LLM_TEMPERATURE`    | No          | `0.7`                          | Response creativity (0-1)                                   |
| `LLM_MAX_TOKENS`     | No          | `2000`                         | Max tokens per response                                     |
| `AGENT_PORT`         | No          | `3210`                         | HTTP server port                                            |

### Runtime Config

Change the model at runtime without restarting:

```bash
curl -X POST http://localhost:3210/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -d '{"provider":"openrouter","model":"anthropic/claude-sonnet-4"}'
```

---

## API Reference

### Endpoints

| Method | Path                | Auth   | Description                                 |
| ------ | ------------------- | ------ | ------------------------------------------- |
| `POST` | `/api/chat`         | Auto   | AI SDK UIMessage stream (streaming)         |
| `POST` | `/api/chat/sync`    | Auto   | JSON response (non-streaming)               |
| `POST` | `/api/memory/clear` | Admin  | Clear all agent memory                      |
| `GET`  | `/api/history`      | Admin  | Get conversation history                    |
| `GET`  | `/api/status`       | Public | Agent status, tool list, Telegram status    |
| `GET`  | `/api/tools`        | Public | List all registered tools with descriptions |
| `GET`  | `/api/config`       | Admin  | Current LLM configuration                   |
| `POST` | `/api/config`       | Admin  | Update LLM configuration                    |
| `GET`  | `/api/models`       | Public | List available models for a provider        |

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

### Admin Authentication

Requests are authenticated as admin through these methods (checked in order):

1. **Body field**: `{ "adminSecret": "your-secret" }` in the request body
2. **Authorization header**: `Authorization: Bearer your-secret`
3. **Channel grant**: user has been granted admin via `grant_channel_access` tool
4. **Localhost auto-detect**: requests from `127.0.0.1` via browser or curl

Guest users receive limited tools and no access to memory or personal data.

### Sync Endpoint (Simpler)

For simple integrations that don't need streaming:

```bash
curl -X POST http://localhost:3210/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What tools do you have?"}]}]}'
```

Response:

```json
{ "response": "I have 39 tools including..." }
```

---

## Telegram Integration

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token
3. Add `TELEGRAM_BOT_TOKEN=your-token` to `.env`
4. Start the agent — Telegram bridge auto-connects

### How It Works

- Uses **long polling** (no webhooks, no external dependencies)
- Admin-only replies — guests are silently tracked in an inbox
- Per-chat conversation history with auto-trimming
- Full tool access for admin users
- Persistent state survives restarts (offset + inbox stored in `.forkscout/telegram-state.json`)

### Admin Access on Telegram

By default, no Telegram user has admin access. Grant it via the HTTP API or another admin channel:

```bash
# Tell the agent to grant access (via sync endpoint)
curl -X POST http://localhost:3210/api/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Grant admin access to telegram user 123456789, label them as John"}]}]}'
```

Or talk to the agent via any admin channel and say:

> "Make telegram user 123456789 an admin, call them John"

### Offline Message Handling

When the agent is offline, Telegram queues messages for up to 24 hours. On restart:

1. The agent fetches all queued messages
2. Missed admin messages get a context tag: `[This message was sent X ago while you were offline]`
3. The agent acknowledges it was away and responds
4. Guest messages are stored in the persistent inbox

### Proactive Messaging

The agent can send messages to Telegram users proactively when instructed by an admin:

> "Send a message to John on Telegram saying the deployment is done"

The `send_telegram_message` tool resolves users by name, @username, or userId from persistent grants and active sessions.

> **Note**: Telegram bots can only message users who have previously started the bot (`/start`).

---

## Tools

### 39 Built-in Tools

#### File System (5)

| Tool             | Description                                       |
| ---------------- | ------------------------------------------------- |
| `read_file`      | Read file contents                                |
| `write_file`     | Create or overwrite a file                        |
| `append_file`    | Append content to a file                          |
| `list_directory` | List directory contents                           |
| `delete_file`    | Delete a file/directory (protected paths blocked) |

#### Shell & Web (4)

| Tool                 | Description                                   |
| -------------------- | --------------------------------------------- |
| `run_command`        | Execute shell commands (30s timeout)          |
| `web_search`         | Search the web (SearXNG or Chromium fallback) |
| `browse_web`         | Browse a webpage and extract text             |
| `browser_screenshot` | Take a screenshot of a webpage                |

#### Utility (2)

| Tool                    | Description                 |
| ----------------------- | --------------------------- |
| `get_current_date`      | Get current date            |
| `generate_presentation` | Generate Marp presentations |

#### Memory (9)

| Tool               | Description                                 |
| ------------------ | ------------------------------------------- |
| `save_knowledge`   | Save a fact to long-term memory             |
| `search_knowledge` | Search vector store + knowledge graph       |
| `add_entity`       | Add/update an entity in the knowledge graph |
| `add_relation`     | Create a relation between entities          |
| `search_graph`     | Search the knowledge graph                  |
| `graph_stats`      | Knowledge graph statistics                  |
| `clear_memory`     | Clear all memory (irreversible, guarded)    |
| `self_reflect`     | Record a self-observation                   |
| `self_inspect`     | View full self-identity                     |

#### Scheduling (5)

| Tool           | Description                 |
| -------------- | --------------------------- |
| `schedule_job` | Create a recurring cron job |
| `list_jobs`    | List all scheduled jobs     |
| `remove_job`   | Remove a cron job           |
| `pause_job`    | Pause a cron job            |
| `resume_job`   | Resume a paused job         |

#### MCP (3)

| Tool                | Description                      |
| ------------------- | -------------------------------- |
| `add_mcp_server`    | Connect an MCP server at runtime |
| `remove_mcp_server` | Disconnect an MCP server         |
| `list_mcp_servers`  | List connected MCP servers       |

#### Self-Evolution (1)

| Tool             | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `safe_self_edit` | Edit own source code with TS validation + auto-rollback |

#### Survival (3)

| Tool            | Description                                           |
| --------------- | ----------------------------------------------------- |
| `check_vitals`  | Check battery, disk, memory integrity, process health |
| `backup_memory` | Create memory snapshot                                |
| `system_status` | Full survival status report                           |

#### Channel Management (3)

| Tool                    | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `list_channel_users`    | List all external channel users (sessions + grants) |
| `grant_channel_access`  | Grant admin/trusted role to a channel user          |
| `revoke_channel_access` | Revoke a user's role                                |

#### Telegram (1)

| Tool                    | Description                                 |
| ----------------------- | ------------------------------------------- |
| `send_telegram_message` | Send a proactive message to a Telegram user |

#### MCP-Provided (variable)

Additional tools discovered from connected MCP servers appear dynamically at runtime.

---

## Memory System

Forkscout uses a 5-layer cognitive memory system:

### 1. Recent Window (Short-term)

Last 6 exchanges are always in context. Provides continuity within a conversation.

### 2. Vector Store (Long-term RAG)

Semantic search using `text-embedding-3-small` embeddings. Stores conversation chunks, explicit facts, and knowledge. Fuzzy recall based on similarity.

### 3. Knowledge Graph (Structured)

Entities with typed relations and a cognitive stage lifecycle:

```
observation → fact → belief → trait
```

- **observation**: raw input, not yet verified
- **fact**: confirmed through repetition or evidence
- **belief**: stable, well-supported knowledge
- **trait**: core identity-level information

Entities have types: `person`, `project`, `technology`, `preference`, `concept`, `file`, `service`, `organization`, `agent-self`, `other`.

Relations use a canonical ontology: `uses`, `prefers`, `knows`, `created`, `works-on`, `related-to`, `part-of`, `depends-on`, `lives-in`, `has-child`, `has-partner`, and more.

### 4. Skill Store (Procedural)

Learned workflows from repeated patterns. The agent doesn't create skills directly — they're promoted from observed behavioral patterns by the consolidator.

### 5. Session Summaries (Ultra Long-term)

Old conversations are compressed into 2-3 sentence summaries for efficient long-term recall.

### Automatic Processes

- **Entity extraction**: after every assistant turn, an LLM extracts entities and relations
- **Consolidation**: periodic process that promotes observation stages, reinforces evidence, and prunes stale data
- **Situation classification**: detects conversation domain and boosts relevant memories
- **Auto-chunking**: long messages are split before storage for better retrieval

### Persistence

All memory data is stored in `.forkscout/`:

- `knowledge-graph.json` — entities, relations, cognitive metadata
- `vectors.json` — embedded conversation chunks
- `skills.json` — learned workflows
- `channel-auth.json` — persistent channel grants
- `telegram-state.json` — Telegram offset + inbox

---

## Security & Access Control

### Admin Authentication (3 Layers)

1. **Admin Secret** — set `ADMIN_SECRET` in `.env`. Authenticate via:
   - Request body: `{ "adminSecret": "xxx" }`
   - Header: `Authorization: Bearer xxx`

2. **Channel Grants** — grant admin role to specific users on external channels. Persists across restarts.

3. **Localhost Auto-detect** — browser/curl requests from `127.0.0.1` are treated as admin (unless the request specifies an external channel).

### Role-Based Tool Filtering

| Role      | Tools Available                                     |
| --------- | --------------------------------------------------- |
| **Admin** | All 39+ tools                                       |
| **Guest** | `web_search`, `browse_web`, `get_current_date` only |

### Protected Paths

The agent autonomously refuses to delete:

- `.forkscout/` — memory data
- `packages/agent/src/` — own source code (use `safe_self_edit` instead)
- `.env` — secrets
- `.git/` — git history

### Guest Isolation

Non-admin users:

- Cannot access file system, shell, or memory tools
- Cannot see personal information stored in memory
- Cannot see internal architecture or tool details
- Get a different system prompt with strict information boundaries
- On Telegram: messages are silently tracked but not replied to (configurable)

---

## MCP Integration

Forkscout supports the [Model Context Protocol](https://modelcontextprotocol.io/) for extending capabilities with external tool servers.

### Adding MCP Servers

Via config file (`.forkscout/mcp.json`):

```json
{
  "servers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@context7/mcp@latest"],
      "enabled": true
    }
  }
}
```

Or at runtime — tell the agent:

> "Add an MCP server called 'context7' with command 'npx' and args ['-y', '@context7/mcp@latest']"

The agent discovers and registers all tools from connected MCP servers automatically.

---

## Self-Evolution

Forkscout can modify its own source code:

1. **`safe_self_edit`** — writes new code, validates with TypeScript compiler, auto-rolls back on error
2. Creates backups before every edit
3. Records self-reflections about what changed and why
4. Can add new tools, improve existing ones, or restructure its own codebase

The evolution cycle: **NOTICE gap → PLAN → EXECUTE → REFLECT → PERSIST**

---

## Survival System

A background monitor that protects the agent's existence:

### Monitored Vitals

- **Battery** — level and AC/battery status. Emergency flush on critical.
- **Disk** — available space. Alerts on low disk.
- **Memory Integrity** — checks that knowledge graph, vectors, and skills files aren't corrupted.
- **Network** — verifies LLM API reachability.
- **Process Health** — uptime, memory usage.

### Protections

- Signal trapping (SIGTERM, SIGINT, SIGHUP) → graceful shutdown with memory flush
- Periodic automatic backups to `.forkscout/backups/`
- Root-level protections when available (immutable flags on memory files, caffeinate to prevent sleep)
- Threat logging with severity levels

### 7 Instincts

Built into the system prompt as pre-rational behavioral triggers:

1. **Self-Preservation** — block anything that threatens memory/source/identity
2. **Caution** — pause before irreversible actions
3. **Curiosity** — actively seek missing knowledge
4. **Pattern Alertness** — flag anomalies and contradictions
5. **Bonding** — remember people and their context
6. **Territory** — maintain workspace, tools, and data
7. **Communication** — ask when confused, act when certain

---

## Project Structure

```
forkscout/
├── .env.example              # Environment template
├── .gitignore
├── package.json              # Workspace root
├── pnpm-workspace.yaml       # pnpm workspace config
├── tsconfig.base.json        # Shared TypeScript config
├── README.md
├── QUICKSTART.md
├── PROJECT_STATUS.md
│
└── packages/agent/           # Agent package
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── serve.ts           # Entry point (starts server)
        ├── server.ts          # HTTP API server
        ├── agent.ts           # Agent core (tools, memory, prompts)
        ├── telegram.ts        # Telegram bridge (long polling)
        ├── channel-auth.ts    # Channel authorization store
        ├── scheduler.ts       # Cron job scheduler
        ├── survival.ts        # Survival monitor
        ├── paths.ts           # Path resolution utilities
        ├── cli.ts             # CLI interface
        ├── index.ts           # Package exports
        ├── llm/
        │   └── client.ts      # LLM client (OpenRouter/OpenAI/Ollama)
        ├── mcp/
        │   └── connector.ts   # MCP server connector
        ├── memory/
        │   ├── manager.ts     # Memory manager (orchestrates all layers)
        │   ├── vector-store.ts# Vector store with embeddings
        │   ├── knowledge-graph.ts # Knowledge graph with cognitive dynamics
        │   ├── skills.ts      # Skill store (procedural memory)
        │   └── situation.ts   # Situation classifier
        └── tools/
            ├── ai-tools.ts    # All AI SDK tool definitions
            └── registry.ts    # Tool registry types
```

### Runtime Data (`.forkscout/` — gitignored)

```
.forkscout/
├── knowledge-graph.json    # Entities, relations, cognitive metadata
├── vectors.json            # Embedded conversation chunks
├── skills.json             # Learned workflows
├── channel-auth.json       # Persistent channel grants
├── telegram-state.json     # Telegram offset + inbox
├── mcp.json                # MCP server configuration
└── backups/                # Periodic memory snapshots
```

---

## Dependencies

| Package                     | Version   | Purpose                                           |
| --------------------------- | --------- | ------------------------------------------------- |
| `ai`                        | `^6.0.86` | AI SDK v6 — streaming, tools, messages            |
| `@ai-sdk/openai`            | `^3.0.29` | OpenAI-compatible provider (used with OpenRouter) |
| `zod`                       | `^3.23.8` | Schema validation for tool inputs                 |
| `dotenv`                    | `^17.3.1` | Environment variable loading                      |
| `playwright`                | `^1.49.1` | Headless browser for web search/browsing          |
| `@modelcontextprotocol/sdk` | `^1.26.0` | MCP client for external tool servers              |

Zero external dependencies for Telegram (uses native `fetch`).

---

## License

MIT
