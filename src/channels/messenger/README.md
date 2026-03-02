# Facebook Messenger Channel

## Purpose

Facebook Messenger bot via Messenger Platform API (webhook).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every Messenger webhook event → agent. Zero message parsing.

## Env Vars

- `MESSENGER_PAGE_ACCESS_TOKEN` — Facebook Page access token
- `MESSENGER_VERIFY_TOKEN` — Webhook verification token
- `MESSENGER_PORT` — Webhook port (default: 3982)

## Config

```json
"messenger": {
  "ownerPsids": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 15
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
