# Tools — How This Folder Works

## Two-Directory System

Tools live in **two** directories, both auto-discovered at runtime:

| Directory        | Purpose                                                 | In Git?            |
| ---------------- | ------------------------------------------------------- | ------------------ |
| `src/tools/`     | **Bootstrap tools** — critical, always-needed at step 0 | ✅ Yes             |
| `.agents/tools/` | **Extended tools** — everything else, runtime-managed   | ❌ No (gitignored) |

`auto_discover_tools.ts` scans **both** directories.  
**No manual registration needed.** Drop a `.ts` file in either folder — it's live.

### ⚠️ Keep Bootstrap Minimal

Every bootstrap tool is injected into the LLM context at **step 0 of every request**, increasing token usage and slowing responses. Only mark a tool as bootstrap if the agent **cannot function without it**.

**Before adding to `src/tools/`**, ask: _"Does the agent need this on literally every single message?"_  
If no → put it in `.agents/tools/` instead.

---

## File Standard

Each tool file must follow this exact structure:

```ts
// .agents/tools/do_something_tools.ts  (or src/tools/ if bootstrap)
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

| Rule                | Detail                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| File name           | `snake_case_tools.ts` — always ends with `_tools`                                               |
| Export name         | Same as file name minus `.ts`, e.g. `read_file_tools` in `read_file_tools.ts`                   |
| `IS_BOOTSTRAP_TOOL` | `true` = step 0 tool, lives in `src/tools/`. `false` = extended tool, lives in `.agents/tools/` |
| `inputSchema`       | Always `z.object({...})` with `.describe()` on every field                                      |
| `execute`           | Always takes `(input)` — never destructure in the signature                                     |
| One tool per file   | Never put two tools in one file                                                                 |
| Error handling      | Always catch, return `{ success: false, error: string }`                                        |
| Imports with `@/`   | Works in both directories — `tsconfig.json` includes `.agents/**/*`                             |

---

## Bootstrap vs Extended

```
IS_BOOTSTRAP_TOOL = true   → src/tools/     → bootstrapTools  (step 0, always injected)
IS_BOOTSTRAP_TOOL = false  → .agents/tools/ → allTools only   (available after discovery)
```

**Rule of thumb:** If you're unsure, default to `.agents/tools/` with `IS_BOOTSTRAP_TOOL = false`.  
The fewer bootstrap tools, the lighter and faster the agent.

---

## Adding a New Tool

### Extended tool (default — most tools go here)

1. Create `.agents/tools/your_tool_name_tools.ts`
2. Export `IS_BOOTSTRAP_TOOL = false` and a const named `your_tool_name_tools`
3. Done — auto-discovered on next run

### Bootstrap tool (only if truly critical)

1. Create `src/tools/your_tool_name_tools.ts`
2. Export `IS_BOOTSTRAP_TOOL = true` and the tool const
3. ⚠️ This adds token overhead to **every** agent request — be sure it's necessary

```ts
// .agents/tools/get_weather_tools.ts
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

### Bootstrap (`src/tools/`) — 9 tools

| File                            | Export                       |
| ------------------------------- | ---------------------------- |
| `find_tools.ts`                 | `find_tools`                 |
| `list_dir_tools.ts`             | `list_dir_tools`             |
| `read_file_tools.ts`            | `read_file_tools`            |
| `read_folder_standard_tools.ts` | `read_folder_standard_tools` |
| `run_shell_command_tools.ts`    | `run_shell_command_tools`    |
| `think_step_by_step_tools.ts`   | `think_step_by_step_tools`   |
| `web_browser_tools.ts`          | `web_browser_tools`          |
| `web_search_tools.ts`           | `web_search_tools`           |
| `write_file_tools.ts`           | `write_file_tools`           |

### Extended (`.agents/tools/`) — 25 tools

| File                          | Export                     |
| ----------------------------- | -------------------------- |
| `analyze_image_tools.ts`      | `analyze_image_tools`      |
| `android_tv_control_tools.ts` | `android_tv_control_tools` |
| `compress_text_tools.ts`      | `compress_text_tools`      |
| `csv_tools.ts`                | `csv_tools`                |
| `diff_tools.ts`               | `diff_tools`               |
| `dispatch_workers_tools.ts`   | `dispatch_workers_tools`   |
| `file_ops_tools.ts`           | `file_ops_tools`           |
| `git_operations_tools.ts`     | `git_operations_tools`     |
| `http_request_tools.ts`       | `http_request_tools`       |
| `json_tools.ts`               | `json_tools`               |
| `n8n_trigger_tools.ts`        | `n8n_trigger_tools`        |
| `network_scan_tools.ts`       | `network_scan_tools`       |
| `openai_tts_tools.ts`         | `openai_tts_tools`         |
| `pdf_tools.ts`                | `pdf_tools`                |
| `project_sourcemap_tools.ts`  | `project_sourcemap_tools`  |
| `regex_tools.ts`              | `regex_tools`              |
| `rss_tools.ts`                | `rss_tools`                |
| `run_code_tools.ts`           | `run_code_tools`           |
| `scrape_page_tools.ts`        | `scrape_page_tools`        |
| `secret_vault_tools.ts`       | `secret_vault_tools`       |
| `self_cron_jobs_tools.ts`     | `self_cron_jobs_tools`     |
| `sqlite_tools.ts`             | `sqlite_tools`             |
| `telegram_message_tools.ts`   | `telegram_message_tools`   |
| `tts_tools.ts`                | `tts_tools`                |
| `validate_and_restart.ts`     | `validate_and_restart`     |

---

## What NOT to do

- ❌ Don't add tools to `index.ts` manually
- ❌ Don't put multiple tools in one file
- ❌ Don't use `parameters:` — it's `inputSchema:` (AI SDK v6)
- ❌ Don't destructure in execute signature: `({ param })` → use `(input)` then `input.param`
- ❌ Don't create a tool file without the `_tools` suffix
- ❌ Don't mark a tool as bootstrap unless the agent literally cannot function without it
- ❌ Don't put non-bootstrap tools in `src/tools/` — they belong in `.agents/tools/`
