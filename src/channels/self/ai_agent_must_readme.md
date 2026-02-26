# src/channels/self/ — Self Channel

## Purpose

The **self** channel lets the agent talk to itself on a schedule (cron jobs).
All agent-to-self interactions are recorded in their own persistent history,
isolated from user-facing channels.

## Use cases

- Scheduled autonomous tasks (daily reports, health checks, cleanup routines)
- Background research jobs that run without user prompting
- Any code path that calls `runAgent` on behalf of the agent itself (not a human)

## File standard

| File                      | Role                                              |
| ------------------------- | ------------------------------------------------- |
| `index.ts`                | Channel implementation + `startCronJobs()` export |
| `ai_agent_must_readme.md` | This file                                         |

## Session key convention

Every job gets its own isolated history:

```
self-{jobName}   →   .forkscout/chats/self-{jobName}.json
```

e.g. `self-daily-report`, `self-health-check`

## Config schema

Jobs are defined in `forkscout.config.json` under `"self"`:

```json
{
  "self": {
    "historyTokenBudget": 12000,
    "jobs": [
      {
        "name": "daily-report",
        "schedule": "0 9 * * *",
        "message": "Run the daily status report and summarise what happened.",
        "notifyTelegram": true
      }
    ]
  }
}
```

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
