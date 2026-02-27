# `src/channels/terminal/` — Terminal Channel

## Purpose

Interactive readline CLI channel for local development and testing. Streams tokens live to stdout
as the agent responds. Maintains persistent conversation history across restarts. Started with
`bun run cli` or `bun run cli:dev`.

---

## Files

| File       | Responsibility                                                            |
| ---------- | ------------------------------------------------------------------------- |
| `index.ts` | Single-file channel — readline loop, streaming output, history management |

---

## Key Behaviour

- Uses **`streamAgent()`** (not `runAgent`) — tokens print to stdout as they arrive
- Persistent history via `chat-store.ts` — survives restarts
- Session key: `terminal-{os.username}` → `.agent/chats/terminal-{username}.json`
- History trimmed to `config.llm.historyTokenBudget` tokens before each call
- After trimming, leading non-`user` messages are dropped (AI SDK v6 requirement)
- `clear` command wipes history and resets the in-memory history array
- `exit` / `quit` / Ctrl-C exits cleanly

---

## History Storage

- Session key: `terminal-{username}` → `.agent/chats/terminal-{username}.json`
- Token-counted with `gpt-tokenizer`
- `trimHistory(history, tokenBudget)` — trims oldest first, then strips leading non-user messages

---

## Exports

`default satisfies Channel` — the only export. Registered in `src/index.ts` under the `--cli` flag.

```ts
export default {
  name: "terminal",
  start
} satisfies Channel;
```

---

## Rules

- **`start()` never returns** — it runs the readline loop forever until the user exits
- **No module-level state** — all state (`history`, `rl`) is scoped inside `start()`
- **Streaming only** — never switch to `runAgent()` here; live token output is the terminal UX
- **No auth** — terminal is local-only; all users are trusted
- **No Telegram imports** — keep this channel isolated from other channel implementations
