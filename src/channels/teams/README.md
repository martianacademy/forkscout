# Microsoft Teams Channel

## Purpose

Microsoft Teams bot using Bot Framework (`botbuilder`).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every Teams Activity → agent. Zero message parsing.

## Env Vars

- `TEAMS_APP_ID` — Bot's Microsoft App ID
- `TEAMS_APP_PASSWORD` — Bot's Microsoft App Password
- `TEAMS_PORT` — HTTP port for incoming activities (default: 3978)

## Config

```json
"teams": {
  "ownerIds": [],
  "allowedUserIds": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 15
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
