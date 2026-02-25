# Logs — How This Folder Works

## What Lives Here

| File              | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `logger.ts`       | Module-tagged console logger — use this everywhere instead of `console.*` |
| `activity-log.ts` | NDJSON file writer — records every event to `.forkscout/activity.log`     |

---

## Using the Logger

```ts
import { log } from "@/logs/logger.ts";

const logger = log("my-module"); // tag shown in every line

logger.info("Starting..."); // → [my-module] Starting...
logger.warn("Slow response", 3200); // → [my-module] Slow response 3200
logger.error("Failed", err.message);
```

**Rules:**

- Never use raw `console.log` / `console.error` / `console.warn` anywhere in `src/`
- Always call `log("module-name")` at the top of the file — one logger per file
- Module name should match the file path e.g. `"telegram"`, `"agent"`, `"tools/web_search"`, `"mcp"`

---

## Activity Log Events

Every `logger.*` call automatically writes to `.forkscout/activity.log`.  
You can also write typed events directly via `logActivity()` or the `activity` helper:

```ts
import { activity, logActivity } from "@/logs/activity-log.ts";

// helpers
activity.msgIn("telegram", chatId, userText);
activity.msgOut("telegram", chatId, responseText, steps, durationMs);
activity.token(chunk, "terminal");
activity.toolCall("web_search", { query: "..." });
activity.toolResult("web_search", { results: [...] }, durationMs);

// raw
logActivity({ type: "info", module: "agent", text: "custom event" });
```

### Event Types

| Type          | When to use                                            |
| ------------- | ------------------------------------------------------ |
| `msg_in`      | User message received by a channel                     |
| `msg_out`     | Full agent response sent back to user                  |
| `token`       | Single streamed token/chunk from LLM (every character) |
| `tool_call`   | Agent invoked a tool — log name + args                 |
| `tool_result` | Tool returned — log name + result + duration           |
| `info`        | General informational log from any module              |
| `warn`        | Non-fatal warning                                      |
| `error`       | Error / exception with context                         |

---

## Output File

- **Location**: `.forkscout/activity.log` (project root, gitignored)
- **Format**: NDJSON — one JSON object per line
- **Watch live**: `tail -f .forkscout/activity.log`
- **Filter by type**: `grep '"type":"tool_call"' .forkscout/activity.log | jq .`
- **Filter by channel**: `grep '"channel":"telegram"' .forkscout/activity.log | jq .`

---

## Adding a New Event Type

1. Add the type to `ActivityEventType` union in `activity-log.ts`
2. Add a convenience helper to the `activity` object
3. Call it from the relevant module

Do NOT add new files to this folder for a specific feature — everything goes through `activity-log.ts` + `logger.ts`.
