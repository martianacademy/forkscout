# src/channels/whatsapp/ — WhatsApp Baileys Channel

Connects ForkScout to WhatsApp using [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web multi-device protocol).

## Features

- Text message send/receive (private + group)
- Per-chat persistent history (`loadHistory`/`appendHistory`/`prepareHistory` pipeline)
- Abort-and-replace: new message cancels in-flight task for the same chat
- Typing indicator ("composing" presence while agent works)
- Auth: owner JIDs (from vault `WHATSAPP_OWNER_JIDS` or config) + allowlist
- Rate limiting per sender
- Input length cap
- Auto-reconnect on disconnect (except logout)
- QR code login printed to terminal on first run

## Setup

1. Start the channel:

   ```bash
   forkscout whatsapp
   # or: bun run whatsapp
   ```

2. Scan the QR code printed in terminal with WhatsApp on your phone.

3. Session credentials are saved in `.agents/whatsapp-sessions/` — subsequent starts auto-connect.

4. (Optional) Set owner JIDs in vault:
   ```bash
   # JID format: <phone>@s.whatsapp.net  (e.g. 919876543210@s.whatsapp.net)
   # Store as comma-separated list
   /secret store WHATSAPP_OWNER_JIDS 919876543210@s.whatsapp.net
   ```

## Config (`forkscout.config.json`)

```json
{
  "whatsapp": {
    "sessionDir": ".agents/whatsapp-sessions",
    "historyTokenBudget": 12000,
    "ownerJids": [],
    "allowedJids": [],
    "rateLimitPerMinute": 15,
    "maxInputLength": 2000,
    "ownerOnlyTools": ["run_shell_commands", "write_file"]
  }
}
```

| Field                | Default                     | Description                                                 |
| -------------------- | --------------------------- | ----------------------------------------------------------- |
| `sessionDir`         | `.agents/whatsapp-sessions` | Where Baileys stores session credentials                    |
| `historyTokenBudget` | `12000`                     | Max tokens in per-chat history before trimming              |
| `ownerJids`          | `[]`                        | JIDs with owner access (prefer vault `WHATSAPP_OWNER_JIDS`) |
| `allowedJids`        | `[]`                        | JIDs allowed to use agent. Empty = everyone (dev mode)      |
| `rateLimitPerMinute` | `15`                        | Max messages per sender per minute. 0 = disabled            |
| `maxInputLength`     | `2000`                      | Max message chars. 0 = disabled                             |
| `ownerOnlyTools`     | `[...]`                     | Tool names restricted to owners                             |

## File Structure

| File        | Purpose                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `index.ts`  | Channel implementation — `start()`, message handling, auth, abort pattern |
| `README.md` | This file — folder contract                                               |

## Limitations

- **Text only** — images, audio, video, documents are ignored (captions are processed)
- **No WhatsApp Business API** — uses the personal/multi-device protocol via Baileys
- **Risk** — Baileys uses reverse-engineered protocol; WhatsApp may block the number
- **No admin role** — only owner and user (unlike Telegram which has owner/admin/user)

## Rules

| Rule                     | Detail                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `start()` runs forever   | Must never return                                          |
| No `process.exit()`      | Channel must not kill the process                          |
| No module-level state    | All state scoped inside `start()` or module maps           |
| Config via `getConfig()` | Hot-reloadable; re-read on each message                    |
| Error handling           | Catch internally; send clean user message; never bubble up |
