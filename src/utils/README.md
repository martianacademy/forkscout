# Utils — How This Folder Works

Pure utility functions shared across the codebase.  
No framework coupling. No side effects at import time. No tool registration.

---

## What belongs here

Pure logic that:

- Has no dependency on `ai`, `@/agent`, or `@/channels`
- Can be imported by tools, channels, or agent code without circularity
- Is reusable across multiple call sites

**Examples of things that belong here:**

- Text processing (tokenisation, summarisation, compression)
- Data transformation utilities
- Pure math / formatting helpers

**Things that do NOT belong here:**

- Tool definitions (→ `src/tools/`)
- LLM-specific logic (→ `src/llm/` when it exists)
- Channel-specific helpers (→ `src/channels/<channel>/`)
- Config loading (→ `src/config.ts`)

---

## File Standard

```ts
// src/utils/my_util.ts

/**
 * Brief JSDoc explaining what this module provides.
 */

/** Helper (unexported) */
function helper(x: string): string {
  return x.trim();
}

/** Public API — named exports only, no default export */
export function myUtil(input: string): string {
  return helper(input);
}
```

### Rules

| Rule           | Detail                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| File name      | `snake_case.ts`                                                             |
| Exports        | Named exports only — no `export default`                                    |
| Side effects   | None at module level — no I/O, no global state, no timers                   |
| Dependencies   | Only other utils, `zod`, or Node/Bun built-ins                              |
| Error handling | Throw for programming errors; return sensible defaults for empty input      |
| Tests          | Pure functions → easy to unit test; add tests when the logic is non-trivial |

---

## Current Utilities

### `extractive-summary.ts`

Extractive text summarisation — no LLM, no network.

| Export                                          | Description                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `extractiveSummary(text, opts?)`                | Returns the top-N most informative sentences in original order          |
| `compressIfLong(text, maxChars, maxSentences?)` | Returns text as-is if short enough, otherwise calls `extractiveSummary` |

**Algorithm:** TF-scored sentence extraction

1. Split into sentences
2. Build term-frequency map (stopwords ignored)
3. Score each sentence by normalised TF sum
4. Pick top-N, restore original order, join with `...`

**Used by:**

- `src/channels/telegram/index.ts` — `capToolResults()` compresses oversized tool results before storing in history
- `src/tools/compress_text.ts` — exposes this as an agent-callable tool

**Config knobs (in `forkscout.config.json`):**

```json
"maxToolResultTokens": 3000,
"maxSentencesPerToolResult": 20
```

---

## Adding a new utility

1. Create `src/utils/my_util.ts` — named exports only
2. Add a row to the **Current Utilities** table above
3. Import with `@/utils/my_util.ts` from wherever you need it
4. Run `bun run typecheck` — must be clean before moving on
