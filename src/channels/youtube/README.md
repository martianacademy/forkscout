# YouTube Live Chat Channel

## Purpose

YouTube Live Chat bot via YouTube Data API v3 (polling).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every YouTube Live Chat message → agent. Zero message parsing.

## Env Vars

- `YOUTUBE_API_KEY` — YouTube Data API key
- `YOUTUBE_LIVE_CHAT_ID` — Live chat ID (from the active stream)
- `YOUTUBE_ACCESS_TOKEN` — OAuth2 access token for sending messages

## Config

```json
"youtube": {
  "ownerChannelIds": [],
  "historyTokenBudget": 12000,
  "pollIntervalMs": 5000,
  "rateLimitPerMinute": 30
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
