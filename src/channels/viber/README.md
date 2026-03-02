# Viber Channel

## Purpose

Viber bot via Viber Bot API (webhook).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every Viber callback event → agent. Zero message parsing.

## Env Vars

- `VIBER_AUTH_TOKEN` — Viber bot auth token
- `VIBER_WEBHOOK_URL` — Public URL for webhook registration
- `VIBER_PORT` — Webhook port (default: 3981)

## Config

```json
"viber": {
  "ownerIds": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 15
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
