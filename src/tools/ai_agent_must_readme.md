# Tools — How This Folder Works

## Auto-discovery

`auto_discover_tools.ts` scans this directory at runtime.  
Every `.ts` file (except `index.ts` and `auto_discover_tools.ts`) is imported automatically.  
**No manual registration needed.** Drop a file here — it's live.

---

## File Standard

Each tool file must follow this exact structure:

```ts
// src/tools/do_something_tools.ts
import { tool } from "ai";
import { z } from "zod";

// Required — controls step-0 availability
export const IS_BOOTSTRAP_TOOL = false;

// Required — export name MUST match the file name (minus .ts)
export const do_something_tools = tool({
  description: "One clear sentence: what this tool does and when to use it.",
  inputSchema: z.object({
    param: z.string().describe("What this param is for")
  }),
  execute: async (input) => {
    // do work
    return { success: true, result: input.param };
  }
});
```

### Rules

| Rule                | Detail                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| File name           | `snake_case_tools.ts` — always ends with `_tools`                                                                              |
| Export name         | Same as file name minus `.ts`, e.g. `read_file_tools` in `read_file_tools.ts`                                                  |
| `IS_BOOTSTRAP_TOOL` | `true` = available at agent step 0 (before any tool search). Use only for critical/always-needed tools. `false` = regular tool |
| `inputSchema`       | Always `z.object({...})` with `.describe()` on every field                                                                     |
| `execute`           | Always takes `(input)` — never destructure in the signature                                                                    |
| One tool per file   | Never put two tools in one file                                                                                                |
| Error handling      | Always catch, return `{ success: false, error: string }`                                                                       |

---

## Bootstrap vs Regular

```
IS_BOOTSTRAP_TOOL = true   → bootstrapTools  (step 0, always injected)
IS_BOOTSTRAP_TOOL = false  → allTools only   (available after discovery)
```

Currently bootstrap: `run_shell_command_tools`, `think_step_by_step_tools`, `read_file_tools`,
`write_file_tools`, `list_dir_tools`, `web_search_tools`, `browse_web_tools`,
`read_folder_standard_tools`, `find_tools`

---

## Adding a New Tool

1. Create `src/tools/your_tool_name_tools.ts`
2. Export `IS_BOOTSTRAP_TOOL` and a const named `your_tool_name_tools`
3. Done — auto-discovered on next run

```ts
// src/tools/get_weather_tools.ts
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false;

export const get_weather_tools = tool({
  description: "Get current weather for a city.",
  inputSchema: z.object({
    city: z.string().describe("City name")
  }),
  execute: async (input) => {
    const res = await fetch(`https://wttr.in/${input.city}?format=j1`);
    const data = await res.json();
    return { success: true, data };
  }
});
```

---

## Current Tools

| File                            | Export                       | Bootstrap |
| ------------------------------- | ---------------------------- | --------- |
| `browse_web_tool.ts`            | `browse_web_tools`           | ✅        |
| `find_tools.ts`                 | `find_tools`                 | ✅        |
| `list_dir_tools.ts`             | `list_dir_tools`             | ✅        |
| `read_file_tools.ts`            | `read_file_tools`            | ✅        |
| `read_folder_standard_tools.ts` | `read_folder_standard_tools` | ✅        |
| `run_shell_command_tools.ts`    | `run_shell_command_tools`    | ✅        |
| `think_step_by_step_tools.ts`   | `think_step_by_step_tools`   | ✅        |
| `web_search_tools.ts`           | `web_search_tools`           | ✅        |
| `write_file_tools.ts`           | `write_file_tools`           | ✅        |
| `compress_text_tools.ts`        | `compress_text_tools`        | —         |
| `self_cron_jobs_tools.ts`       | `self_cron_jobs_tools`       | —         |
| `telegram_message_tools.ts`     | `telegram_message_tools`     | —         |

---

## What NOT to do

- ❌ Don't add tools to `index.ts` manually
- ❌ Don't put multiple tools in one file
- ❌ Don't use `parameters:` — it's `inputSchema:` (AI SDK v6)
- ❌ Don't destructure in execute signature: `({ param })` → use `(input)` then `input.param`
- ❌ Don't create a tool file without the `_tools` suffix
