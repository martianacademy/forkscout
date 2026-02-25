# LLM Helpers — How This Folder Works

Thin wrappers around the AI SDK for LLM-specific tasks that don't belong in
`src/utils/` (which must stay framework-free) and aren't full agent runs.

---

## What belongs here

- LLM utility calls: summarisation, classification, extraction, embedding
- Retry / backoff wrappers around `generateText` / `streamText`
- Error classifiers (retryable vs fatal)
- Token budget helpers
- Routing / fallback logic

**NOT here:**

- Tool definitions → `src/tools/`
- Channel logic → `src/channels/`
- Full agent runs → `src/agent/`
- Pure text utilities with no LLM → `src/utils/`

---

## File Standard

```ts
// src/llm/my_helper.ts
import { generateText } from "ai";
import { getConfig } from "@/config.ts";
import { getProvider } from "@/providers/index.ts";

/** JSDoc: what this does, when to use it */
export async function myHelper(input: string): Promise<string> {
  const config = getConfig();
  const { provider, providers } = config.llm;
  const model = getProvider(provider).chat(providers[provider].fast);
  const { text } = await generateText({ model, prompt: input, maxTokens: 256 });
  return text;
}
```

### Rules

| Rule                | Detail                                                                |
| ------------------- | --------------------------------------------------------------------- |
| File name           | `snake_case.ts`                                                       |
| Exports             | Named exports only — no `export default`                              |
| Model tier          | Always use `fast` tier unless the task requires more — keep costs low |
| Error handling      | Catch LLM errors, either rethrow with context or return a fallback    |
| maxTokens           | Set explicitly — never leave unbounded                                |
| No circular imports | Must not import from `@/tools`, `@/channels`, or `@/agent`            |

---

## Current Files

### `summarize.ts`

LLM-powered abstractive summarisation using the fast tier model.

| Export                      | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `llmSummarize(text, opts?)` | Calls fast-tier LLM to synthesise text into key points |

**Options:**

```ts
{
  maxTokens?: number;   // default: 400
  instruction?: string; // custom prompt — overrides default "summarise" instruction
}
```

**Falls back** to extractive summarisation (`src/utils/extractive-summary.ts`) if the LLM call fails — never throws.

**Used by:** `src/tools/compress_text.ts` when `mode: "llm"` is selected.

---

## Adding a new helper

1. Create `src/llm/my_helper.ts` — named exports only
2. Add a row to the **Current Files** table above
3. Import with `@/llm/my_helper.ts`
4. Run `bun run typecheck` — must be clean before moving on
