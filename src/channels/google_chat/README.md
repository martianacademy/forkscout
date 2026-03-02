# Google Chat Channel

## Purpose

Google Chat bot via Google Workspace API (webhook/push or polling).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every Google Chat event → agent. Zero message parsing.

## Env Vars

- `GOOGLE_CHAT_WEBHOOK_PORT` — Port for incoming webhook (default: 3979)
- `GOOGLE_CHAT_SERVICE_ACCOUNT` — Path to service account JSON

## Config

```json
"googleChat": {
  "ownerEmails": [],
  "allowedSpaces": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 15
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
