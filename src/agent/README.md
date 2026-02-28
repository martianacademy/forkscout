# Agent — How This Folder Works

## Overview

This folder contains the core LLM runner and everything that shapes how the agent thinks and behaves.

```
agent/
  index.ts            — runAgent(): entry point called per Telegram message
  system-prompts/
    identity.ts       — base system prompt (who the agent is, how it works)
```

---

## `runAgent(config, { userMessage })`

**Flow:**

1. Discovers local tools (`src/tools/`) and MCP tools (`src/mcp-servers/`) in parallel
2. Composes the system prompt: `identity` + optional `config.agent.systemPromptExtra`
3. Calls `generateText` (AI SDK v6) with all tools, maxSteps, maxTokens
4. Returns `{ text, steps, bootstrapToolNames }`

**No history is passed** — each message is stateless. Chat memory should go through an MCP tool (e.g. `forkscout_memory`).

---

## Adding Behavior

### Extend the system prompt via config

```json
// forkscout.config.json
{
  "agent": {
    "systemPromptExtra": "Always respond in Hinglish."
  }
}
```

This gets appended to `identity` at runtime. No code changes needed.

### Replace the base identity

Edit `system-prompts/identity.ts`. It exports a single `identity` string constant.

---

## Rules

| Rule                             | Detail                                             |
| -------------------------------- | -------------------------------------------------- |
| `runAgent` is stateless          | No conversation history — each call is independent |
| Tool discovery is internal       | Do not pass tools from outside — agent handles it  |
| System prompt = identity + extra | Identity is always first, extra is optional append |
| Return `{ text, steps }`         | Caller (Telegram) uses `text` for the reply        |
