# Instagram DMs Channel

## Purpose

Instagram Direct Messages via Instagram Graph API (webhook).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every Instagram webhook event → agent. Zero message parsing.

## Env Vars

- `INSTAGRAM_ACCESS_TOKEN` — Instagram/Facebook Page access token
- `INSTAGRAM_VERIFY_TOKEN` — Webhook verification token
- `INSTAGRAM_PORT` — Webhook port (default: 3983)

## Config

```json
"instagram": {
  "ownerIgIds": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 15
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
