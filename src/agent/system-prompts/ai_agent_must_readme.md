# System Prompts — How This Folder Works

## Overview

Each file in this folder is a prompt module — a named string export that shapes agent behavior.  
`agent/index.ts` composes the final system prompt from these modules.

---

## File Standard

Each prompt file exports a single trimmed string constant:

```ts
// src/agent/system-prompts/my_section.ts

export const my_section = `
Your instructions here.
`.trim();
```

### Rules

| Rule             | Detail                                            |
| ---------------- | ------------------------------------------------- |
| File name        | `snake_case.ts`                                   |
| Export name      | Same as file name                                 |
| Single export    | One named string per file                         |
| Always `.trim()` | Remove leading/trailing whitespace                |
| No side effects  | Pure string constants only — no imports, no logic |

---

## Current Files

| File          | Purpose                                                            |
| ------------- | ------------------------------------------------------------------ |
| `identity.ts` | Base system prompt — agent name, interface, tools, core principles |

## Subfolders

| Folder        | Purpose                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `extensions/` | On-demand instruction modules loaded by the agent via `read_file` when needed. See `extensions/ai_agent_must_readme.md` for details. |

---

## Composing Prompts

Prompts are manually composed in `agent/index.ts`:

```ts
import { identity } from "@/agent/system-prompts/identity";

const systemPrompt = config.agent.systemPromptExtra
  ? `${identity}\n\n${config.agent.systemPromptExtra}`
  : identity;
```

To add a new section, import it and concatenate:

```ts
import { identity } from "@/agent/system-prompts/identity";
import { my_section } from "@/agent/system-prompts/my_section";

const systemPrompt = `${identity}\n\n${my_section}`;
```
