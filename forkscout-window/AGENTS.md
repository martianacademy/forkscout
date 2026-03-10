# Forkscout Window — Standalone Chrome Extension

> **Complete building spec for AI agents.**
> This document fully describes the architecture, file structure, types, and protocols needed to build or rebuild this extension from scratch. All AI calls happen directly from the browser — no backend required.

---

## Overview

Forkscout Window is a Chrome Extension (Manifest V3) that opens as a **side panel**. It provides:

- Direct AI chat via 11+ providers (OpenAI, Anthropic, Google, Groq, OpenRouter, Mistral, DeepSeek, xAI, Ollama, LMStudio, Custom)
- In-browser streaming via native `fetch` + SSE — no Node.js SDK
- All data in `chrome.storage.local` (sessions, memories, settings)
- Page context injection (URL, title, selection text)
- Full settings UI (provider, model, API key, system prompt, temp, tokens)
- Optional MCP bridge: WebSocket client that lets forkscout-agent call tools in the extension

---

## Tech Stack

| Layer          | Choice                                     |
| -------------- | ------------------------------------------ |
| Runtime        | Chrome Extension MV3                       |
| UI framework   | React 18 + TypeScript 5.7                  |
| Build tool     | Vite 6                                     |
| Styling        | CSS Modules + global `index.css` variables |
| AI calls       | Browser-native `fetch` (no SDK)            |
| Storage        | `chrome.storage.local`                     |
| Service worker | Plain JS (`background.js`)                 |

---

## Directory Structure

```
forkscout-window/
├── manifest.json               # MV3 manifest
├── background.js               # Service worker: side panel, context menu, MCP bridge
├── content/
│   └── content.js              # Content script: page context extractor
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── sidepanel/                  # Vite build output (gitignored) — DO NOT EDIT
│   └── index.html
└── ui/                         # React source
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    ├── package.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── App.module.css
        ├── index.css
        ├── types.ts
        ├── ai/
        │   ├── providers.ts    # Provider registry + model catalogues
        │   └── stream.ts       # Browser streaming engine
        ├── store/
        │   └── storage.ts      # chrome.storage typed wrapper
        ├── hooks/
        │   ├── useSettings.ts
        │   ├── usePageContext.ts
        │   └── useChat.ts
        └── components/
            ├── MessageList.tsx / .module.css
            ├── InputBar.tsx / .module.css
            ├── SettingsPanel.tsx / .module.css
            ├── HistorySidebar.tsx / .module.css
            └── MemoryPanel.tsx / .module.css
```

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Forkscout",
  "version": "1.0.0",
  "description": "AI assistant with memory, history, and multi-provider support",
  "permissions": [
    "sidePanel",
    "activeTab",
    "scripting",
    "storage",
    "tabs",
    "contextMenus"
  ],
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "sidepanel/index.html" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {},
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## Types (`ui/src/types.ts`)

```typescript
export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "openrouter"
  | "mistral"
  | "deepseek"
  | "xai"
  | "ollama"
  | "lmstudio"
  | "custom";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  baseURL: string;
  format: "openai" | "anthropic" | "google";
  requiresKey: boolean;
  models: ModelOption[];
}

export interface ModelOption {
  id: string;
  name: string;
  contextLength: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Memory {
  id: string;
  content: string;
  source: "user" | "auto" | "agent";
  createdAt: number;
}

export interface Settings {
  provider: ProviderId;
  model: string;
  apiKeys: Partial<Record<ProviderId, string>>;
  customBaseURL: string;
  systemPrompt: string;
  temperature: number; // 0–2
  maxTokens: number; // 256–8192
  streaming: boolean;
  injectPageContext: boolean;
  injectMemories: boolean;
  memoryCount: number; // how many memories to inject
  agentUrl: string; // forkscout-agent URL for MCP bridge
  agentToken: string;
  mcpBridgeEnabled: boolean;
}

export interface PageContext {
  url: string;
  title: string;
  text: string;
  selectedText: string;
}

// Storage key constants
export const SK = {
  SETTINGS: "fw_settings",
  SESSIONS: "fw_sessions",
  MEMORIES: "fw_memories",
  ACTIVE_SESSION: "fw_active_session"
} as const;
```

---

## AI Engine

### `ui/src/ai/providers.ts`

Exports `PROVIDERS: ProviderDef[]` with 11 entries. Each has:

- `id`, `name`, `baseURL`, `format: "openai"|"anthropic"|"google"`, `requiresKey`, `models[]`

Provider base URLs:

- openai: `https://api.openai.com/v1`
- anthropic: `https://api.anthropic.com`
- google: `https://generativelanguage.googleapis.com/v1beta`
- groq: `https://api.groq.com/openai/v1`
- openrouter: `https://openrouter.ai/api/v1`
- mistral: `https://api.mistral.ai/v1`
- deepseek: `https://api.deepseek.com`
- xai: `https://api.x.ai/v1`
- ollama: `http://localhost:11434/v1`
- lmstudio: `http://localhost:1234/v1`
- custom: configurable via `customBaseURL`

Special headers:

- anthropic: `anthropic-version: 2023-06-01`, `anthropic-dangerous-allow-browser: true`
- openrouter: `HTTP-Referer: chrome-extension://forkscout`, `X-Title: Forkscout`
- google: API key added as `?key=` query param

### `ui/src/ai/stream.ts`

Core function: `async function* streamChat(params): AsyncGenerator<StreamChunk>`

```typescript
interface StreamParams {
  provider: ProviderDef;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
}

type StreamChunk =
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };
```

Routing:

- `format === "anthropic"` → `streamAnthropic()`
- `format === "google"` → `streamGoogle()` (SSE with `?alt=sse&key=KEY`)
- everything else → `streamOpenAI()` (handles `stream: true/false`)

SSE parsing:

- OpenAI/Groq/etc: parse `data: {...}` lines, read `choices[0].delta.content`
- Anthropic: parse `data: {...}` lines, type `content_block_delta`, `delta.text`
- Google: parse `data: {...}` lines, `candidates[0].content.parts[0].text`

---

## Storage (`ui/src/store/storage.ts`)

All functions are async wrappers over `chrome.storage.local`.

```typescript
// Settings
loadSettings(): Promise<Settings>
saveSettings(s: Settings): Promise<void>

// Sessions
loadSessions(): Promise<ChatSession[]>
saveSessions(sessions: ChatSession[]): Promise<void>
upsertSession(session: ChatSession): Promise<void>
deleteSession(id: string): Promise<void>

// Active session
loadActiveSessionId(): Promise<string | null>
saveActiveSessionId(id: string): Promise<void>

// Memories
loadMemories(): Promise<Memory[]>
saveMemories(mems: Memory[]): Promise<void>
addMemory(content: string, source?: Memory["source"]): Promise<Memory>
deleteMemory(id: string): Promise<void>
updateMemory(id: string, content: string): Promise<void>

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  model: "gpt-4o-mini",
  apiKeys: {},
  customBaseURL: "",
  systemPrompt: "You are a helpful AI assistant.",
  temperature: 0.7,
  maxTokens: 2048,
  streaming: true,
  injectPageContext: true,
  injectMemories: true,
  memoryCount: 10,
  agentUrl: "http://localhost:3200",
  agentToken: "",
  mcpBridgeEnabled: false,
}
```

---

## Hooks

### `useSettings`

- Loads settings on mount
- Subscribes to `chrome.storage.local.onChanged` for live sync
- Returns `{ settings, ready, update(patch) }`

### `usePageContext`

- Sends `GET_PAGE_CONTEXT` message to service worker on mount
- Listens for `PAGE_CONTEXT` and `TAB_CHANGED` messages
- Returns `PageContext | null`

### `useChat(settings, pageContext)`

Returns: `{ sessions, activeSession, messages, isStreaming, error, newSession, selectSession, deleteSession, send, stopStream, clearSession, setError }`

Key behaviors:

- `buildSystemContent()`: merges `settings.systemPrompt` + top-N memories (if `injectMemories`) + page context (if `injectPageContext`)
- `send(text)`: pushes user message, calls `streamChat()`, accumulates delta chunks into assistant message
- Auto-titles sessions from first 50 chars of first user message
- Stop stream: sets `abortRef.current = true` which breaks the `for await` loop

---

## Components

### `MessageList`

- Props: `messages: Message[]`, `isStreaming: boolean`
- Renders chat bubbles; filters out `role === "system"`
- Lightweight markdown: code blocks (with language label + Copy), inline `code`, paragraph splitting on `\n\n`
- Shows typing dot animation when `isStreaming && last message has empty content`

### `InputBar`

- Props: `onSend`, `isStreaming`, `onStop`
- Textarea with Shift+Enter for newline, Enter to send
- Shows ■ Stop when streaming, ↑ Send otherwise

### `SettingsPanel`

- Props: `settings: Settings`, `onSave(s: Settings)`, `onClose`
- Provider grid (2-col clickable cards)
- Model cards with context length
- API key inputs per provider (key type: password)
- Ollama/LMStudio/Custom: base URL field
- System prompt textarea
- Temperature slider (0–2)
- Max tokens input
- Streaming / injectPageContext / injectMemories toggles
- Forkscout Agent Bridge section (mcpBridgeEnabled toggle + agentUrl + agentToken)

### `HistorySidebar`

- Props: `sessions`, `activeId`, `onSelect`, `onDelete`, `onNew`, `onClose`
- Session list with title, provider chip, relative timestamp
- Delete button (hover-visible)

### `MemoryPanel`

- Self-contained (loads/saves its own memories via storage.ts)
- Add memory textarea (Enter to add)
- Edit in-place (textarea + Save/Cancel)
- Delete button per memory
- Source badge (user/auto/agent)

### `App`

Views: `"chat" | "history" | "memory"` plus settings sheet overlay.
Bottom nav with emoji labels (💬 Chat / 📋 History / 🧠 Memory).

---

## CSS Variables (`index.css`)

```css
:root {
  --bg: #0f0f11;
  --surface: #1a1a1f;
  --surface2: #25252c;
  --border: #2a2a3a;
  --accent: #7c6af7;
  --accent-dim: #4e43a8;
  --text: #e4e4ed;
  --muted: #7a7a8e;
  --error: #f87171;
  --radius: 12px;
  --radius-sm: 8px;
}
```

---

## MCP Bridge Protocol

When `settings.mcpBridgeEnabled === true`, `background.js` opens a WebSocket to `{agentUrl}/ext-mcp` (converts `http://` → `ws://`).

### Registration (extension → agent)

```json
{ "type": "REGISTER", "token": "<agentToken>", "capabilities": [...] }
```

### Tool call (agent → extension)

```json
{
  "type": "TOOL_CALL",
  "id": "call_123",
  "tool": "get_page_context",
  "args": {}
}
```

### Tool result (extension → agent)

```json
{ "type": "TOOL_RESULT", "id": "call_123", "result": { ... } }
```

### Available tools

| Tool               | Args                  | Returns                              |
| ------------------ | --------------------- | ------------------------------------ |
| `get_page_context` | —                     | `{ url, title, text, selectedText }` |
| `navigate_to`      | `{ url: string }`     | `{ ok: true }`                       |
| `inject_prompt`    | `{ prompt: string }`  | `{ ok: true }` (sends to side panel) |
| `get_selection`    | —                     | `{ text: string }`                   |
| `run_script`       | `{ code: string }`    | `{ result: unknown }`                |
| `get_chat_history` | —                     | `{ sessions[], activeSession }`      |
| `add_memory`       | `{ content: string }` | `{ ok: true, memory: Memory }`       |

Reconnect: exponential backoff from 1s → max 30s.

---

## Build & Install

```bash
cd forkscout-window/ui
npm install
npm run build          # outputs to ../sidepanel/

# Then load forkscout-window/ as an unpacked extension in chrome://extensions
```

`vite.config.ts` key settings:

```typescript
export default defineConfig({
  build: {
    outDir: "../sidepanel",
    emptyOutDir: true
  }
});
```

---

## Standalone Usage

This folder (`forkscout-window/`) is self-contained. To use independently:

1. Move `forkscout-window/` anywhere
2. `cd ui && npm install && npm run build`
3. Load the `forkscout-window/` folder as an unpacked Chrome extension
4. Open any tab → click the extension icon → side panel opens
5. Set your API key in Settings ⚙

No forkscout-agent needed unless you want the MCP bridge for cross-tool communication.
