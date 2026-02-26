# `src/channels/telegram/` — Telegram Channel

## Purpose

Telegram long-polling bot channel. Receives messages via `getUpdates`, routes them through the agent,
and sends responses back as Telegram messages. Handles access control, chat history, message queuing,
rate limiting, and typing indicators.

---

## Files

| File                 | Responsibility                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`           | Main channel — exports `default satisfies Channel`. Long-poll loop, message routing, history management, access control commands |
| `api.ts`             | Thin wrapper around the Telegram Bot API (HTTP calls only, no business logic)                                                    |
| `format.ts`          | Text transformations: Markdown→HTML, HTML stripping, long-message splitting                                                      |
| `access-requests.ts` | Persists access requests in `.forkscout/access-requests.json` and `.forkscout/auth.json`                                         |

---

## Key Internals (`index.ts`)

| Symbol                | Type                          | Purpose                                                                          |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `chatHistories`       | `Map<number, ModelMessage[]>` | Per-chat conversation history — keyed by `chatId`                                |
| `chatQueues`          | `Map<number, Promise<void>>`  | Per-chat sequential queue — prevents race conditions when messages arrive fast   |
| `rateLimiter`         | `Map<number, {...}>`          | Per-user rate limit — count + window start                                       |
| `runtimeAllowedUsers` | `Set<number>`                 | Runtime allowlist — seeded from config, grows via `/allow`                       |
| `runtimeOwnerUsers`   | `Set<number>`                 | Runtime owner set — seeded from config, grows via `/allow admin`                 |
| `devMode`             | `boolean`                     | True when both `ownerUserIds` and `allowedUserIds` are empty (everyone is owner) |

---

## Access Roles

| Role     | Who                                                  | Powers                                 |
| -------- | ---------------------------------------------------- | -------------------------------------- |
| `owner`  | `config.telegram.ownerUserIds` + `/allow <id> admin` | All tools, all commands, no rate limit |
| `user`   | `config.telegram.allowedUserIds` + `/allow <id>`     | Conversation only, rate-limited        |
| `denied` | Everyone else                                        | Blocked, access request recorded       |

Owner commands: `/allow <userId> [admin]`, `/deny <userId>`, `/requests` (list pending)

---

## `api.ts` Exports

| Function                        | Signature                                      | Returns                       |
| ------------------------------- | ---------------------------------------------- | ----------------------------- |
| `sendMessage`                   | `(token, chatId, text, parseMode?)`            | `number \| null` (message_id) |
| `editMessage`                   | `(token, chatId, messageId, text, parseMode?)` | `boolean`                     |
| `sendMessageWithInlineKeyboard` | `(token, chatId, text, buttons, parseMode?)`   | `number \| null`              |
| `answerCallbackQuery`           | `(token, callbackQueryId, text?)`              | `boolean`                     |
| `editMessageReplyMarkup`        | `(token, chatId, messageId, keyboard?)`        | `boolean`                     |
| `sendTyping`                    | `(token, chatId)`                              | `void`                        |

---

## `format.ts` Exports

| Function                     | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `mdToHtml(md)`               | Converts Markdown to Telegram HTML (`**bold**` → `<b>bold</b>`, etc.) |
| `stripHtml(html)`            | Removes HTML tags — plain text fallback                               |
| `splitMessage(text, limit?)` | Splits on newlines to stay under Telegram's 4096-char limit           |

---

## `access-requests.ts` Exports

| Symbol                                                    | Type      | Purpose                                                                                         |
| --------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `AccessRequest`                                           | interface | `{ userId, chatId, username, firstName, requestedAt, status, role?, reviewedAt?, reviewedBy? }` |
| `loadRequests()`                                          | fn        | Returns all persisted access requests                                                           |
| `saveRequests(reqs)`                                      | fn        | Writes requests to disk                                                                         |
| `upsertRequest(req)`                                      | fn        | Add or update a request (skips if already non-pending)                                          |
| `updateRequestStatus(userId, status, role?, reviewedBy?)` | fn        | Approve or deny a request                                                                       |
| `addToAuthAllowList(userId, role)`                        | fn        | Adds userId to `.forkscout/auth.json`                                                           |

---

## History Storage

- Session key: `telegram-{chatId}` → `.forkscout/chats/telegram-{chatId}.json`
- Trimmed when total token count exceeds `config.llm.historyTokenBudget`
- After trimming, leading non-`user` messages are dropped (AI SDK v6 requirement)

---

## Rules

- **Never edit `api.ts`** to add business logic — it stays as a thin HTTP wrapper
- **Never call `sendMessage` directly from tools** — use the `telegram_message_tools` tool instead
- **Access control is enforced before the agent runs** — the agent always receives a pre-authorized message
- **All per-chat state is scoped inside `start()`** — no module-level mutable state allowed
- **Typing indicator** runs on a 4-second loop while the agent processes — stops on completion or error
