# Channels — How This Folder Works

## Overview

Each subfolder is a channel — a way for users to interact with the agent.

---

## Contract

Every channel must export a `default` satisfying the `Channel` interface from `types.ts`:

```ts
import type { Channel } from "@/channels/types.ts";

export default {
  name: "mychannel",
  start
} satisfies Channel;

async function start(config: AppConfig): Promise<void> {
  // run indefinitely — poll, listen, or loop
}
```

`satisfies Channel` is enforced at compile time. Missing `name` or `start` = build error.

---

## File Standard

```
src/channels/
  types.ts                  — Channel interface (do not modify unless adding to the contract)
  <channel_name>/
    index.ts                — default export satisfying Channel
    *.ts                    — channel-specific helpers (api calls, transports, etc.)
```

### Rules

| Rule              | Detail                                                      |
| ----------------- | ----------------------------------------------------------- |
| Folder name       | `snake_case`, same as `channel.name`                        |
| Default export    | `{ name, start } satisfies Channel`                         |
| `name`            | Must match folder name                                      |
| `start(config)`   | Runs indefinitely — never returns unless process exits      |
| Error handling    | Catch internally, never let unhandled rejections bubble up  |
| Per-session state | Keep inside `start()` scope — no module-level mutable state |

---

## Registering a New Channel

Add it to the `channels` array in `src/index.ts`:

```ts
import myChannel from "@/channels/mychannel/index.ts";

const channels: Channel[] = [telegramChannel, terminalChannel, myChannel];
```

Then select it with a CLI flag or env var — see `src/index.ts`.

---

## Current Channels

| Channel    | Trigger      | Description                           |
| ---------- | ------------ | ------------------------------------- |
| `telegram` | default      | Long-poll Telegram Bot API            |
| `terminal` | `--cli` flag | Interactive readline chat in terminal |
