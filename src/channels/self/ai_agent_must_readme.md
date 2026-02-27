# src/channels/self/ — Self Channel

## Purpose

The **self** channel lets the agent talk to itself in two ways:

1. **Cron jobs** — scheduled autonomous tasks that fire on a schedule.
2. **HTTP trigger** — on-demand `POST /trigger` endpoint. Any tool (e.g. `message_self`) can POST a prompt here to start a fresh agent session with persistent history. This is the backbone of the **Task Offload Pattern**.

## Use cases

- Scheduled autonomous tasks (daily reports, health checks, cleanup routines)
- Background research jobs that run without user prompting
- Task Offload Pattern: break huge multi-file tasks into sequential sessions, each with fresh context

## File standard

| File                      | Role                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `index.ts`                | Channel implementation + `startCronJobs()` + `startHttpServer()` exports |
| `ai_agent_must_readme.md` | This file                                                                |

## Session key convention

| Source       | Storage key              | Path                                       |
| ------------ | ------------------------ | ------------------------------------------ |
| Cron job     | `self-{jobName}`         | `.agents/chats/self-{jobName}/`         |
| HTTP trigger | `self-http-{sessionKey}` | `.agents/chats/self-http-{sessionKey}/` |

## HTTP API

Server port: `config.self.httpPort` (default: `3200`). Set `0` to disable.

### POST /trigger

```json
{
  "prompt": "Optimize src/tools/browse_web.ts for readability",
  "sessionKey": "optimize-tools",
  "role": "owner"
}
```

Response:

```json
{
  "ok": true,
  "text": "Done. Made the following changes...",
  "steps": 4,
  "sessionKey": "self-http-optimize-tools"
}
```

- `sessionKey` optional — defaults to `"default"` → stored as `self-http-default`
- `role` optional — defaults to `"owner"`
- Requests to the same `sessionKey` are serialised (no concurrent history races)
- History trimmed to `config.self.historyTokenBudget` using the same pipeline as all other channels

### GET /health

Returns `{ "ok": true }` — used by `scripts/safe-restart.sh` smoke test.

## Config schema

```json
{
  "self": {
    "historyTokenBudget": 12000,
    "httpPort": 3200,
    "jobs": [
      {
        "name": "daily-report",
        "schedule": "0 9 * * *",
        "message": "Run the daily status report.",
        "telegram": { "chatIds": [123456789] }
      }
    ]
  }
}
```

Jobs can also live in `.agents/self-jobs.json` (gitignored). File jobs override config jobs (deduplicated by name).

| Field            | Type    | Required | Description                                          |
| ---------------- | ------- | -------- | ---------------------------------------------------- |
| `name`           | string  | ✅       | Unique job ID — used as session key suffix           |
| `schedule`       | string  | ✅       | Standard cron expression (5 fields)                  |
| `message`        | string  | ✅       | Prompt sent to the agent for each run                |
| `notifyTelegram` | boolean | ❌       | If true, sends result to all `telegram.ownerUserIds` |

## Rules

- One file per concern — no non-channel code here
- `start()` runs indefinitely (never returns)
- `startCronJobs()` is exported separately so telegram channel can call it in background
- History uses `loadHistory` / `saveHistory` from `chat-store.ts`
- Never hardcode values — all config from `forkscout.config.json`

## Current contents

- `index.ts` — Channel + cron job runner
