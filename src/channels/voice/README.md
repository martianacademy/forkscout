# Voice Call Channel

## Purpose

Voice call bot via Twilio Voice + TTS/STT.
Incoming calls → STT → agent → TTS → spoken reply.

## File Standard

- `index.ts` — Channel implementation (max 200 lines)
- Raw JSON of Twilio Voice webhook events → agent.

## Env Vars

- `TWILIO_ACCOUNT_SID` — Twilio account SID
- `TWILIO_AUTH_TOKEN` — Twilio auth token
- `TWILIO_PHONE_NUMBER` — Bot's phone number
- `VOICE_PORT` — Webhook port (default: 3985)

## Config

```json
"voice": {
  "ownerPhones": [],
  "historyTokenBudget": 12000,
  "rateLimitPerMinute": 5
}
```

## Rules

- One file per module, max 200 lines
- Uses shared adapter from `../adapter.ts`
