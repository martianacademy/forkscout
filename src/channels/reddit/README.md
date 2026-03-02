# Reddit Channel

## Purpose

Reddit bot — monitors inbox (DMs + mentions + replies) via `snoowrap`.

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every Reddit inbox item → agent. Zero message parsing.

## Env Vars

- `REDDIT_CLIENT_ID` — Reddit app client ID
- `REDDIT_CLIENT_SECRET` — Reddit app client secret
- `REDDIT_USERNAME` — Bot's Reddit username
- `REDDIT_PASSWORD` — Bot's Reddit password

## Config

```json
"reddit": {
  "ownerUsernames": [],
  "pollIntervalMs": 30000,
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 10
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
