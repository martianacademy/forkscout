# LINE Channel

## Purpose

LINE Messaging API bot via `@line/bot-sdk`.

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every LINE webhook event → agent. Zero message parsing.

## Env Vars

- `LINE_CHANNEL_ACCESS_TOKEN` — Channel access token
- `LINE_CHANNEL_SECRET` — Channel secret for webhook verification
- `LINE_PORT` — Webhook port (default: 3980)

## Config

```json
"line": {
  "ownerIds": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 15
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
