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

### `retry.ts`

Exponential backoff retry wrapper for any async LLM call.

| Export                  | Description                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `withRetry(fn, label?)` | Runs `fn()`, retries up to 3× on transient errors with 1s/2s/4s delays                                                                  |
| `LLMError`              | Error class thrown after exhausting retries or on fatal errors. Contains `.classified` (ClassifiedError) for clean user-facing messages |

**Uses `error-classifier.ts`** to decide retryability. Throws `LLMError` (not raw SDK errors) so channels can read `.classified.userMessage`.

**Retries on:** `rate-limit`, `server-error`, `timeout`, `invalid-response` categories.

**Does NOT retry:** `auth-expired`, `bad-request`, `model-not-found`, `insufficient-credits`, `content-filtered`, `config-error`, `prompt-error` — fails immediately with clean message.

**Used by:** `src/agent/index.ts` — wraps `generateText` in `runAgent()`.

---

### `error-classifier.ts`

Classifies LLM errors into structured categories with user-facing messages.

| Export                    | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| `classifyError(error)`    | Returns `ClassifiedError` with category, retryable, userMessage  |
| `isRetryableError(error)` | Quick boolean check — shorthand for `classifyError(e).retryable` |
| `ErrorCategory` (type)    | Union of all category strings                                    |
| `ClassifiedError` (type)  | Full classification result                                       |

**Categories:**

| Category               | Retryable | Example                              |
| ---------------------- | --------- | ------------------------------------ |
| `rate-limit`           | ✅        | 429 Too Many Requests                |
| `server-error`         | ✅        | 502/503/504, ECONNRESET              |
| `timeout`              | ✅        | 408, ETIMEDOUT                       |
| `invalid-response`     | ✅        | HTML gateway page, JSON parse fail   |
| `auth-expired`         | ❌        | 401/403                              |
| `bad-request`          | ❌        | 400                                  |
| `model-not-found`      | ❌        | 404, NoSuchModelError                |
| `insufficient-credits` | ❌        | 402, "exceeded quota"                |
| `content-filtered`     | ❌        | Safety filter, moderation block      |
| `config-error`         | ❌        | Missing API key, unsupported feature |
| `prompt-error`         | ❌        | Prompt too long, InvalidPromptError  |
| `unknown`              | ❌        | Anything unrecognized                |

**Used by:** `retry.ts`, `telegram/index.ts`, `terminal/index.ts`.

---

## Adding a new helper

1. Create `src/llm/my_helper.ts` — named exports only
2. Add a row to the **Current Files** table above
3. Import with `@/llm/my_helper.ts`
4. Run `bun run typecheck` — must be clean before moving on
