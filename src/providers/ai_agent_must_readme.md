# Providers — How This Folder Works

## Overview

This folder manages all AI model providers for the agent.

Every provider is wrapped in a uniform `OpenAICompatibleProvider` interface so the agent only ever calls `.chat(modelId)` — regardless of whether the underlying SDK is Anthropic, Google, OpenRouter, or anything else.

The active provider and tier are selected at runtime from `forkscout.config.json`.

---

## Provider Types

There are three kinds of providers in this codebase:

### 1. Native SDK Providers

Have a dedicated `@ai-sdk/<name>` package. Use `createXxx()` from the package, then wrap in the interface.

```
anthropic_provider.ts    → @ai-sdk/anthropic    (createAnthropic)
google_provider.ts       → @ai-sdk/google        (createGoogleGenerativeAI)
xai_provider.ts          → @ai-sdk/xai           (createXai)
vercel_provider.ts       → @ai-sdk/vercel        (createVercel)
replicate_provider.ts    → @ai-sdk/replicate     (createReplicate)
huggingface_provider.ts  → @ai-sdk/huggingface   (createHuggingFace)
deepseek_provider.ts     → @ai-sdk/deepseek      (createDeepSeek)
```

### 2. OpenAI-Compatible Endpoint Providers

No dedicated SDK — just point `createOpenAICompatibleProvider` at the endpoint's base URL.

```
openrouter_provider.ts   → https://openrouter.ai/api/v1
perplexity_provider.ts   → https://api.perplexity.ai
```

> **Why `.chat()` and not `provider(modelId)`?**
> AI SDK v6 changed `openai(modelId)` to use the **Responses API by default**.
> Third-party compatible endpoints (OpenRouter, Perplexity, Groq, etc.) only support
> **Chat Completions**. Always use `provider.chat(modelId)` for them, or use
> `createOpenAICompatibleProvider` which does this automatically.

### 3. Non-LLM Providers

Speech/transcription/image providers. **NOT registered in the LLM registry.**
Use their dedicated helper functions directly in your code.

```
elevenlabs_provider.ts   → TTS + STT only (getElevenLabsSpeechModel, getElevenLabsTranscriptionModel)
```

---

## File Standard

```
src/providers/
  index.ts                            — registry + getProvider() + getModel()
  open_ai_compatible_provider.ts      — base factory + OpenAICompatibleProvider interface
  ai_agent_must_readme.md             — this file
  <name>_provider.ts                  — one file per provider
```

### Naming Rules

| Rule         | Detail                                           |
| ------------ | ------------------------------------------------ |
| File name    | `<name>_provider.ts` in `snake_case`             |
| Export name  | `create<Name>Provider()` — factory function      |
| Registry key | Same as the `name` field in the provider object  |
| Config key   | Same as registry key, in `forkscout.config.json` |
| Env var      | `<NAME>_API_KEY` (or `_API_TOKEN` for Replicate) |

---

## Interface Contract

All LLM providers must implement `OpenAICompatibleProvider`:

```ts
// from open_ai_compatible_provider.ts
export interface OpenAICompatibleProvider {
  name: string;
  chat(modelId: string): LanguageModel;
}
```

`chat(modelId)` must always return a `LanguageModel` compatible with the Vercel AI SDK.

---

## Model Tiers

Each provider defines three tiers in `forkscout.config.json`:

```json
"providers": {
    "<provider>": {
        "fast":     "<cheap/fast model id>",
        "balanced": "<default model id>",
        "powerful": "<best/most capable model id>"
    }
}
```

The agent resolves the active model as:

```ts
const modelId = config.llm.providers[config.llm.provider][config.llm.tier];
getProvider(config.llm.provider).chat(modelId);
```

Switch provider or tier by editing `"provider"` and `"tier"` in `forkscout.config.json`.

---

## How to Create a Custom Provider

### Option A — Native SDK (dedicated `@ai-sdk/<name>` package)

Use this when there's an official AI SDK package for the service.

**Step 1** — Install the package:

```bash
bun add @ai-sdk/groq
```

**Step 2** — Create `src/providers/groq_provider.ts`:

```ts
// src/providers/groq_provider.ts
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import type { OpenAICompatibleProvider } from "@/providers/open_ai_compatible_provider.ts";

export function createGroqProvider(apiKey?: string): OpenAICompatibleProvider {
  const provider = createGroq({
    apiKey: apiKey ?? process.env.GROQ_API_KEY ?? ""
  });

  return {
    name: "groq",
    chat(modelId: string): LanguageModel {
      return provider(modelId) as LanguageModel;
    }
  };
}
```

> ⚠️ Some SDKs are not directly callable. If `provider(modelId)` gives a type error,
> try `provider.chat(modelId)`, `provider.languageModel(modelId)`, or check the
> package's exported keys with:
>
> ```bash
> node -e "const p = require('@ai-sdk/groq').createGroq({apiKey:''}); console.log(Object.keys(p).join(', '))"
> ```

---

### Option B — OpenAI-Compatible Endpoint (no dedicated package)

Use this for any service that speaks the OpenAI Chat Completions API format.

**Step 1** — No install needed. Create `src/providers/together_provider.ts`:

```ts
// src/providers/together_provider.ts
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleProvider
} from "@/providers/open_ai_compatible_provider.ts";

export function createTogetherProvider(
  apiKey?: string
): OpenAICompatibleProvider {
  return createOpenAICompatibleProvider({
    name: "together",
    baseURL: "https://api.together.xyz/v1",
    apiKey: apiKey ?? process.env.TOGETHER_API_KEY ?? ""
  });
}
```

Optional: add custom headers if the API requires them:

```ts
headers: {
    "HTTP-Referer": "https://github.com/forkscout",
    "X-Title": "Forkscout",
},
```

---

### Option C — Non-LLM Provider (TTS / STT / Image)

Non-LLM providers are **not** wrapped in `OpenAICompatibleProvider` and are **not** registered.
Export dedicated helpers instead.

```ts
// src/providers/my_tts_provider.ts
import { createMyTTS } from "@ai-sdk/my-tts";

export function createMyTTSProvider(apiKey?: string) {
  return createMyTTS({ apiKey: apiKey ?? process.env.MY_TTS_API_KEY ?? "" });
}

export function getMyTTSSpeechModel(modelId: string = "default-model") {
  return createMyTTSProvider().speech(modelId);
}
```

---

### Step 3 — Register in `src/providers/index.ts`

Add the import and registry entry:

```ts
import { createGroqProvider } from "@/providers/groq_provider.ts";

const registry: Record<string, () => OpenAICompatibleProvider> = {
  // ... existing providers ...
  groq: () => createGroqProvider()
};
```

---

### Step 4 — Add model tiers to `forkscout.config.json`

```json
"providers": {
    "groq": {
        "fast":     "llama-3.1-8b-instant",
        "balanced": "llama-3.3-70b-versatile",
        "powerful": "deepseek-r1-distill-llama-70b"
    }
}
```

---

### Step 5 — Set the env var

Add to `.env`:

```
GROQ_API_KEY=your_key_here
```

---

### Step 6 — Switch to the new provider

In `forkscout.config.json`:

```json
{
  "llm": {
    "provider": "groq",
    "tier": "balanced"
  }
}
```

---

## Current Providers

### LLM Providers (in registry)

| Key           | File                      | Package               | Env Var                        |
| ------------- | ------------------------- | --------------------- | ------------------------------ |
| `openrouter`  | `openrouter_provider.ts`  | `@ai-sdk/openai`      | `OPENROUTER_API_KEY`           |
| `anthropic`   | `anthropic_provider.ts`   | `@ai-sdk/anthropic`   | `ANTHROPIC_API_KEY`            |
| `google`      | `google_provider.ts`      | `@ai-sdk/google`      | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `xai`         | `xai_provider.ts`         | `@ai-sdk/xai`         | `XAI_API_KEY`                  |
| `vercel`      | `vercel_provider.ts`      | `@ai-sdk/vercel`      | `VERCEL_API_KEY`               |
| `replicate`   | `replicate_provider.ts`   | `@ai-sdk/replicate`   | `REPLICATE_API_TOKEN`          |
| `huggingface` | `huggingface_provider.ts` | `@ai-sdk/huggingface` | `HUGGINGFACE_API_KEY`          |
| `deepseek`    | `deepseek_provider.ts`    | `@ai-sdk/deepseek`    | `DEEPSEEK_API_KEY`             |
| `perplexity`  | `perplexity_provider.ts`  | (OpenAI-compatible)   | `PERPLEXITY_API_KEY`           |

### Non-LLM Providers (not in registry)

| Name         | File                     | Type      | Helper Functions                                                  |
| ------------ | ------------------------ | --------- | ----------------------------------------------------------------- |
| `elevenlabs` | `elevenlabs_provider.ts` | TTS + STT | `getElevenLabsSpeechModel()`, `getElevenLabsTranscriptionModel()` |

---

## Quick Reference

```bash
# Switch provider (edit forkscout.config.json)
"provider": "anthropic"   → uses ANTHROPIC_API_KEY
"provider": "google"      → uses GOOGLE_GENERATIVE_AI_API_KEY
"provider": "openrouter"  → uses OPENROUTER_API_KEY (routes to any model)

# Switch tier (edit forkscout.config.json)
"tier": "fast"      → cheapest/fastest model for the provider
"tier": "balanced"  → default
"tier": "powerful"  → best capability

# Resolve active model (what the agent does internally)
providers[provider][tier]  →  e.g. "claude-sonnet-4-5"
getProvider("anthropic").chat("claude-sonnet-4-5")
```
