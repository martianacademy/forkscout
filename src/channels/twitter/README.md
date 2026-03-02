# Twitter/X DMs Channel

## Purpose

Twitter/X Direct Messages via X API v2 (polling — webhook deprecated).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every X DM event → agent. Zero message parsing.

## Env Vars

- `TWITTER_BEARER_TOKEN` — X API v2 bearer token
- `TWITTER_API_KEY` — API key (consumer key)
- `TWITTER_API_SECRET` — API secret
- `TWITTER_ACCESS_TOKEN` — User access token
- `TWITTER_ACCESS_SECRET` — User access secret

## Config

```json
"twitter": {
  "ownerIds": [],
  "historyTokenBudget": 12000,
  "pollIntervalMs": 30000,
  "rateLimitPerMinute": 15
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
