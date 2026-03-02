# SMS (Twilio) Channel

## Purpose

SMS bot via Twilio Programmable Messaging (webhook).

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of every Twilio webhook event → agent. Zero message parsing.

## Env Vars

- `TWILIO_ACCOUNT_SID` — Twilio account SID
- `TWILIO_AUTH_TOKEN` — Twilio auth token
- `TWILIO_PHONE_NUMBER` — Bot's Twilio phone number (e.g. +1234567890)
- `SMS_PORT` — Webhook port (default: 3984)

## Config

```json
"sms": {
  "ownerPhones": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 10
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
