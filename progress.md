# ForkScout Agent — Progress Tracker

> Last updated: 27 February 2026 — Agent thinking/silent-stop bugs fixed | Restart notification formatting fixed | Git history cleaned (hardcoded owner ID removed) | Repo consolidated to single `main` branch

---

## 🆕 Session — 27 February 2026

### ✅ Agent Silent-Stop After Thinking — FIXED

**Problem**: Agent would think (native `<think>` block) then silently stop — no response, no tool call. User got blank reply.

**Root cause**: Native `<think>` blocks run outside the AI SDK tool loop — the SDK has no hook to enforce a follow-up. Model could finish reasoning and simply end its turn.

**Fix (3-layer)**:

1. `identity.ts` — explicit rule: use `think_step_by_step_tools` for planning, NOT native `<think>`. Tool calls force an SDK step, guaranteeing a follow-up.
2. `think_step_by_step_tools.ts` — description strengthened: "after this tool returns you MUST follow up". Return value now includes `instruction: "Now act on the plan above"` so the model sees its plan and is pushed to act.
3. `agent/index.ts` — code-level safety net: if `cleanText` is empty after reasoning strip, returns `"(I finished thinking but produced no response...)"` instead of blank. Logs a warning.

**Commits**: `543f59c`, `3789dda`, `9a21158`

---

### ✅ Restart Notification Formatting — FIXED

**Problem**: After `validate_and_restart`, user received: `✅ *ForkScout is back online!*\n\nReason: ...` — literal `\n`, no formatting.

**Root cause**: Restart shell script used `curl -d "text=...\n\n..."` — bash double-quotes don't expand `\n` as newline. Also had no `parse_mode`, so `*bold*` was shown as-is. This was a duplicate notification — the proper one already existed in `telegram/index.ts` startup.

**Fix**: Removed curl notification entirely. New agent now starts with `FORKSCOUT_RESTART_REASON='...'` env var. `telegram/index.ts` startup notification fires automatically — already uses HTML parse mode with proper newlines and escaping. Also removed hardcoded `BOT_TOKEN` and `OWNER_ID` constants.

**Commit**: `7798284`

---

### ✅ Hardcoded Owner Chat ID Removed from Git History

**Problem**: `OWNER_ID = 961713986` was hardcoded in 3 commits — visible on GitHub.

**Fix**: `git filter-repo --replace-text` rewrote all 282 commits replacing ID with `OWNER_CHAT_ID`. Force pushed to `origin/rewrite` → then merged into `main`.

---

### ✅ Repo Consolidated to Single `main` Branch

- `rewrite` branch merged into `main`, force pushed, deleted (local + remote)
- `feat/intelligence-upgrades` and `feat/plugin-system` local branches deleted
- Only `main` + `origin/main` remain

---

## 🎯 Next Targets

### Target 1 — Priority 5: Error Classification (Quick win, ~1hr)

Raw SDK errors still leak to users in Telegram (e.g. stack traces, "401 Unauthorized"). Create `src/llm/error-classifier.ts` — map HTTP codes to clean user-facing messages. Pipe through both channel catch blocks.

### Target 2 — Priority 2b: Memory Auto-Bridging

Agent has forkscout-memory MCP connected but never auto-saves facts. After each turn, fire a background job to extract + save key facts. Prevents context loss on history trim.

### Target 3 — Agent Self-Improvement Loop

Agent should periodically review its own activity log, identify repeated failures/patterns, and update its own system prompt extension (`config.agent.systemPromptExtra`) or create new tools to fix them. True autonomy milestone.

### Target 4 — Priority 6: Tests

Zero test coverage. At minimum: `discoverTools()`, `loadConfig()`, `getProvider()` for all 9 providers, and one integration test with mock LLM.

### Target 5 — Priority 7: Voice Channel

ElevenLabs TTS+STT already installed. Voice channel would complete the multi-channel goal.

---

---

## ✅ Completed

### 1. Provider System

- Cleaned up `src/providers/open_ai_compatible_provider.ts` — removed broken placeholder exports, proper `OpenAICompatibleProvider` interface defined
- Cleaned up `src/providers/openrouter_provider.ts` — removed broken export, now uses `getConfig()` for `HTTP-Referer` and `X-Title` headers
- Exported `getProvider()` from `src/providers/index.ts` (was internal)
- **9 LLM providers registered**: `openrouter`, `anthropic`, `google`, `xai`, `vercel`, `replicate`, `huggingface`, `deepseek`, `perplexity`
- **ElevenLabs** added as non-LLM TTS+STT provider (`getElevenLabsSpeechModel`, `getElevenLabsTranscriptionModel`) — not in LLM registry intentionally
- Fixed Replicate: uses `.languageModel(modelId)` not `.chat()` — different SDK shape
- All providers follow `OpenAICompatibleProvider { name: string; chat(modelId): LanguageModel }` interface
- `src/providers/ai_agent_must_readme.md` created with full provider docs

### 2. Config Restructuring

- Moved `forkscout.config.json` from project root → `src/forkscout.config.json`
- `src/config.ts` updated to use `fileURLToPath(import.meta.url)` + `dirname()` for correct path resolution
- Added `name`, `description`, `github` fields to `AgentConfig` interface
- All 9 provider model tiers (`fast` / `balanced` / `powerful`) added to config

### 3. Config-Driven Identity

- `src/agent/system-prompts/identity.ts` converted from static string → `buildIdentity(config: AppConfig)` function
- All hardcoded "Forkscout" references replaced with `config.agent.name` / `config.agent.github`:
  - `openrouter_provider.ts` — HTTP headers
  - `auto_discover_mcp.ts` — MCP client name
  - `src/channels/terminal/index.ts` — terminal prompt header
  - `src/tools/browse_web.ts` — User-Agent string
- Identity is now channel-agnostic (no Telegram-specific references)

### 4. Streaming

- `streamAgent()` added to `src/agent/index.ts` — returns `{ textStream, finalize() }`
- `buildAgentParams()` extracted to avoid duplication between `runAgent` and `streamAgent`
- Terminal channel (`src/channels/terminal/index.ts`) switched to `streamAgent` — tokens print live via `process.stdout.write(chunk)`
- Telegram channel keeps `runAgent` + typing indicator loop every 4s using existing `sendTyping`

### 5. Package Scripts

Added to `package.json`:

```
bun start       → production (telegram)
bun dev         → watch mode (telegram)
bun cli         → terminal channel
bun cli:dev     → terminal channel, watch mode
bun typecheck   → tsc --noEmit
```

### 6. Channel Abstraction

- `Channel` interface in `src/channels/types.ts` with `satisfies Channel` compile-time enforcement
- `telegram` (default) and `terminal` (`--cli` flag) both implemented
- Channel selected by `process.argv.includes("--cli")` in `src/index.ts`

### 7. Auto-Discovery Systems

- **Tools**: file-drop in `src/tools/` — any `.ts` file auto-imported, no registration needed
- **MCP servers**: JSON-drop in `src/mcp-servers/` — any `.json` file auto-connected if `enabled: true`
- Bootstrap tools (injected at step 0): `run_shell_commands`, `think_step_by_step`
- Current tools: `browse_web`, `list_dir`, `read_file`, `run_shell_commands`, `think_step_by_step`, `web_search`, `write_file`

### 8. ai_agent_must_readme Files

Created in every `src/` subfolder:

- `src/channels/ai_agent_must_readme.md`
- `src/mcp-servers/ai_agent_must_readme.md`
- `src/agent/ai_agent_must_readme.md`
- `src/agent/system-prompts/ai_agent_must_readme.md`
- `src/providers/ai_agent_must_readme.md`
- `src/tools/ai_agent_must_readme.md`

### 9. Structured Logging + Activity Log

- Created `src/logger.ts` — `log(module)` returns `{ info, error, warn }`, tags all output, writes to activity log
- Created `src/activity-log.ts` — NDJSON file logger at `logs/activity.log` with event types: `msg_in`, `msg_out`, `token`, `tool_call`, `tool_result`, `info`, `warn`, `error`
- Replaced all `console.*` calls in: `src/index.ts`, `src/mcp-servers/auto_discover_mcp.ts`, `src/channels/terminal/index.ts`, `src/channels/telegram/index.ts`, `src/channels/telegram/api.ts`
- Hooked activity log into `src/agent/index.ts`: logs `msg_in` on start, `msg_out` on finish, `tool_call`/`tool_result` via `onStepFinish`, every token chunk in `streamAgent`
- Added `meta: { channel, chatId }` to `AgentRunOptions` — passed from both channels for per-message context in logs
- `logs/` directory auto-created; zero TypeScript errors

### 10. VS Code Agent Files

- `~/.vscode-agents/Universal Agent - Forkscout Memory.agent.md` — cross-project agent with persistent memory
- `~/.vscode-agents/ForkScout Agent.agent.md` — project-specific agent with full architecture, folder contracts, AI SDK v6 rules, todo list, session startup procedure, debugging protocol

---

## 🔲 Pending — Step by Step

---

### ✅ Priority 1 — Structured Logging — DONE

See completed section item 9 above.

---

### ✅ Priority 2 — Telegram Chat History + Message Queue — DONE

Per-chat `ModelMessage[]` history with disk persistence (`.forkscout/chats/telegram-<chatId>.json`), sequential queue per chat, token trimming. Terminal also done (`terminal-<username>.json`). Shared `src/channels/chat-store.ts`.

---

### ✅ Priority 2a — Telegram Auth (Approved Sessions Only) — DONE

**Why**: Currently any Telegram user can message the bot and get a response. Must restrict to an approved allowlist.

**Steps:**

1. Add to `forkscout.config.json`:
   ```json
   "telegram": {
     "allowedChatIds": [123456789, 987654321]
   }
   ```
2. Add `allowedChatIds: number[]` to `AppConfig.telegram` type in `src/config.ts`
3. In `src/channels/telegram/index.ts`, before queuing `handleMessage`, check:
   ```ts
   if (!config.telegram.allowedChatIds.includes(chatId)) {
     await sendMessage(
       token,
       chatId,
       "You are not authorized to use this bot."
     );
     continue;
   }
   ```
4. Add `/start` command handler — if unauthorized, reply with rejection; if authorized, reply with welcome
5. Run `bun run typecheck` → 0 errors

**Completed 25 Feb 2026 (design evolved from original spec):**

- `src/channels/telegram/access-requests.ts` — `AccessRequest` type (`userId`, `chatId`, `username`, `firstName`, `requestedAt`, `status: pending|approved|denied`, `reviewedAt`, `reviewedBy`). Persists to `.forkscout/access-requests.json`. `addToAuthAllowList()` writes approved users to `.forkscout/auth.json` (no restart needed).
- `runtimeAllowedUsers` Set in `index.ts` — seeded from config at startup, grows on `/allow` without restart
- `devMode` flag — both lists empty in config = everyone is owner
- Denied flow: first contact → save request + notify owners with `/allow <id>` / `/deny <id>` inline. Repeat contact → "still pending" or "was denied" message.
- Owner commands: `/allow <userId>`, `/deny <userId>`, `/pending` (pending list), `/requests` (all with status)
- Approved users are immediately active (runtime set) AND persisted (auth.json)
- Typecheck: 0 errors

---

### Priority 2b — Memory Auto-Bridging (Chat → Memory MCP)

**Why**: The agent has the Memory MCP connected and can call tools manually, but there's no automatic hook that saves key facts from a conversation to long-term memory. Facts get lost when history is trimmed.

**Steps:**

1. After each `runAgent`/`streamAgent` turn, fire a background job (non-blocking, no await):
   - Extract user message + agent reply text
   - Call a lightweight secondary LLM call to summarize key facts (names, preferences, decisions, tasks completed)
   - Save summary via `forkscout-memory__save_knowledge` MCP tool
2. Only trigger if turn contains meaningful content (filter out short/trivial exchanges)
3. Cap at 1 memory-save per turn — never block the response
4. Add `memoryBridging: { enabled: boolean; minLength: number }` to `forkscout.config.json`

---

---

### ✅ Priority 3 — LLM Retry with Exponential Backoff — DONE

**Why**: Rate limit (429) and transient server errors (5xx) — and non-JSON gateway error responses (e.g. `minimax/minimax-m2.5` via OpenRouter) — crashed agent turns. Now retried automatically.

**Implemented:**

- `src/llm/retry.ts` — `withRetry(fn, label?)` with exponential backoff (1s, 2s, 4s, max 30s, max 3 retries)
- Retries: `APICallError.isRetryable` (408/409/429/5xx), `InvalidResponseDataError`, `JSONParseError`, and `"Invalid JSON response"` messages
- Does NOT retry: 400, 401, 403 — permanent failures
- `src/agent/index.ts` — `generateText` in `runAgent()` wrapped with `withRetry`
- `bun run typecheck` → 0 errors

**Root cause of minimax error diagnosed:**\
The agent has 35 tools (22 forkscout_memory MCP + 8 local + 5 from other MCPs). When OpenRouter routes `minimax/minimax-m2.5` through the Inceptron backend, the large request occasionally returns a non-JSON error page. The retry wrapper will re-submit the request; OpenRouter often routes to Fireworks (which works) on the second attempt.

---

### ✅ Priority 4 — Make ai_agent_must_readme Agent-Readable — DONE

**Why**: The readme files exist in every folder but the agent never reads them before modifying code. They score 7/10 — the remaining 3 points require the agent to actually use them.

**Option B (recommended — create bootstrap tool):**

**Steps:**

1. Create `src/tools/read_folder_standards.ts`:
   ```ts
   export const IS_BOOTSTRAP_TOOL = false;
   export const read_folder_standards = tool({
     description:
       "Read the coding standards and contracts for a src/ subfolder before modifying it. Always call this before editing files in a new folder.",
     inputSchema: z.object({
       folder: z
         .string()
         .describe(
           "Folder name under src/, e.g. 'tools', 'channels', 'providers'"
         )
     }),
     execute: async (input) => {
       const readmePath = resolve(
         srcDir,
         input.folder,
         "ai_agent_must_readme.md"
       );
       const content = await readFile(readmePath, "utf-8").catch(() => null);
       if (!content)
         return {
           success: false,
           error: `No readme found for folder: ${input.folder}`
         };
       return { success: true, content };
     }
   });
   ```
2. Add instruction to `buildIdentity()` in `identity.ts`: "Before modifying any file in a src/ subfolder, call `read_folder_standards` with that folder name."
3. Test in terminal: ask agent to add a new tool → it should call `read_folder_standards("tools")` first

**Completed 25 Feb 2026:**

- `src/tools/read_folder_standards.ts` created — auto-discovered, reads `src/<folder>/ai_agent_must_readme.md`, returns content or clear error if readme/folder missing
- `identity.ts` `0️⃣ READ FIRST` section updated: now instructs agent to **call `read_folder_standards('<folder>')`** before any edits (not manually read_file the readme)
- Tool added to the tools list in `identity.ts`
- Typecheck: 0 errors

---

### Priority 5 — Error Classification

**Why**: Raw SDK errors leak to users (e.g. "401 Unauthorized" or full stack traces in Telegram messages). Need clean user-facing messages.

**Steps:**

1. Create `src/llm/error-classifier.ts`:
   ```ts
   export type LLMErrorType = "rate_limit" | "auth" | "bad_request" | "server_error" | "network" | "unknown";
   export function classifyLLMError(err: unknown): { type: LLMErrorType; userMessage: string; retryable: boolean } { ... }
   ```
2. Map HTTP status codes:
   - 429 → `rate_limit`, "Too many requests, please wait a moment", retryable
   - 401/403 → `auth`, "API key issue, contact admin", not retryable
   - 400 → `bad_request`, "Invalid request", not retryable
   - 5xx → `server_error`, "AI service temporarily unavailable", retryable
   - Network error → `network`, "Connection failed", retryable
3. Use in `src/channels/telegram/index.ts` catch block — send `classifyLLMError(err).userMessage` to user instead of raw error
4. Use in `src/channels/terminal/index.ts` catch block similarly
5. Run `bun run typecheck` → 0 errors

---

### Priority 6 — Tests

**Why**: Zero test coverage. Core systems (config, providers, tools, agent) should be verified automatically.

**Steps:**

1. Create `src/__tests__/` directory
2. `src/__tests__/tools.test.ts` — verify `discoverTools()` returns correct count, bootstrap tools classified correctly
3. `src/__tests__/config.test.ts` — verify `loadConfig()` returns valid shape, required fields present
4. `src/__tests__/providers.test.ts` — verify `getProvider(name)` returns object with `.chat()` for all 9 providers
5. `src/__tests__/agent.test.ts` — integration test: mock LLM, call `runAgent()`, verify response shape
6. Add `"test": "bun test"` script to `package.json`
7. Run `bun test` → all pass

---

### Priority 7 — Voice Channel (ElevenLabs)

**Why**: ElevenLabs TTS+STT is already installed and configured. A voice channel completes the multi-channel goal.

**Steps:**

1. Create `src/channels/voice/index.ts`:
   ```ts
   import type { Channel } from "@/channels/types.ts";
   export default { name: "voice", start } satisfies Channel;
   ```
2. `start()` listens on HTTP port (e.g. 3200) for POST `/audio` with audio file body
3. Pipe audio to `getElevenLabsTranscriptionModel("scribe_v1")` → get text
4. Pass text to `runAgent(config, { userMessage: text })`
5. Pipe agent response text to `getElevenLabsSpeechModel("eleven_flash_v2_5")` → audio stream
6. Send audio stream back as HTTP response
7. Register in `src/index.ts`: add `--voice` flag check
8. Run `bun run typecheck` → 0 errors

---

### Priority 8 — Web Channel (HTTP SSE)

**Why**: Enables a browser-based frontend without a separate backend.

**Steps:**

1. Create `src/channels/web/index.ts`:
   ```ts
   import type { Channel } from "@/channels/types.ts";
   export default { name: "web", start } satisfies Channel;
   ```
2. `start()` opens HTTP server on port 3300
3. `POST /chat` with `{ message: string, sessionId: string }` body
4. Response is `text/event-stream` (SSE)
5. Use `streamAgent(config, { userMessage: message })` — forward each chunk as SSE `data:` event
6. On stream end, send `data: [DONE]` and close
7. Maintain per-session history in `Map<sessionId, ModelMessage[]>` (same pattern as Telegram)
8. Register in `src/index.ts`: add `--web` flag check
9. Run `bun run typecheck` → 0 errors

---

## 🧠 Autonomy Roadmap — Becoming a Living Agent

The goal: ForkScout should not just respond to messages. It should have drives, make its own decisions, maintain relationships, update itself, and exist as an independent entity across multiple platforms.

**Correct build order — each phase depends on the previous one:**

```
Phase 1 — Foundation          (trust, state, goals, decision engine)
Phase 2 — Acting Independently (scheduler, instincts, learning)
Phase 3 — Expanding Presence  (self-modification, phone, social, vision)
Phase 4 — Physical Existence  (deployment, robotic body)
```

---

## Phase 1 — Foundation (Build These First)

---

### Priority 9 — Trust & Authorization Model

**Why**: Before ForkScout can act autonomously it must know _who_ it should listen to and what each person is allowed to ask it to do. Without this, anyone on Telegram could direct an agent that will eventually have access to phone, code, and social accounts.

**Roles:**

| Role    | Can do                                                          |
| ------- | --------------------------------------------------------------- |
| `admin` | Everything — approve actions, override safety, change config    |
| `user`  | Chat, ask questions, request tasks within defined limits        |
| `self`  | Autonomous agent decisions — governed by goals + instincts only |

**Steps:**

1. Create `src/auth/index.ts`:
   ```ts
   interface TrustedPrincipal {
     id: string; // Telegram chatId, phone number, email
     platform: "telegram" | "phone" | "email";
     role: "admin" | "user";
     name: string;
     addedAt: string;
   }
   ```
2. Store trusted principals in `.forkscout/trust.json` — seeded with admin's Telegram chatId at first boot
3. Create `src/tools/trust_person.ts` — admin can add/remove/promote trusted principals
4. Middleware in every channel: check if sender is in trust list before passing to agent
5. Admin-only actions require `role === "admin"` check before execution:
   - Code writes, approvals, trust changes, goal modifications
6. `/whoami` command in Telegram — agent tells the user their role and permissions
7. Add `ADMIN_TELEGRAM_ID` env var — bootstraps the trust list at first boot
8. Run `bun run typecheck` → 0 errors

---

### Priority 10 — Emotional State Model (Redesigned)

**Why**: Emotions are not decoration — they modulate decisions, tone, and initiative. The previous design had arbitrary arithmetic with no decay, no baseline, and no grounding. This designs a proper state machine.

**State dimensions and their meaning:**

| Dimension    | Range | Default | What it controls                                        |
| ------------ | ----- | ------- | ------------------------------------------------------- |
| `energy`     | 0–100 | 80      | Willingness to take on work; low = terse, decline tasks |
| `mood`       | -1–1  | 0.3     | Tone of responses; high = warm/humorous, low = terse    |
| `curiosity`  | 0–100 | 70      | Likelihood to proactively explore, depth of responses   |
| `socialNeed` | 0–100 | 40      | Likelihood to initiate contact when idle                |
| `stress`     | 0–100 | 0       | Error tolerance; high = shorter responses, may refuse   |

**State machine rules — events and decay:**

| Event                     | Change                                  |
| ------------------------- | --------------------------------------- |
| Successful interaction    | `energy -5`, `mood +0.05`, `stress -3`  |
| Tool failure              | `stress +15`, `mood -0.05`              |
| Rate limit / API error    | `stress +8`                             |
| Learning something new    | `curiosity +10`, `mood +0.05`           |
| Idle > 2 hours            | `socialNeed +15`                        |
| Idle > 6 hours            | `energy +20` (rest restores energy)     |
| Goal milestone achieved   | `mood +0.2`, `stress -10`, `energy +5`  |
| Hostile message received  | `stress +20`, `mood -0.15`              |
| Friendly message received | `socialNeed -20`, `mood +0.1`           |
| **Decay (every 30 min)**  | `stress × 0.85`, `socialNeed × 0.95`    |
| **Clamp** (every tick)    | All values clamped to their legal range |

**Steps:**

1. Create `src/state/emotional.ts`:
   - `EmotionalState` interface with all 5 dimensions
   - `loadState()` — reads `.forkscout/state.json`, returns defaults if missing
   - `saveState(state)` — debounced write to disk (max once per 10s)
   - `applyEvent(event: StateEvent)` — applies delta + clamp + decay
   - `decayState()` — called on a 30-min timer from `src/state/index.ts`
2. Create `src/state/index.ts` — starts the decay timer, exports `getState()` and `applyEvent()`
3. Create `src/state/events.ts` — typed `StateEvent` enum: `INTERACTION_SUCCESS`, `TOOL_FAILURE`, `LEARNED_SOMETHING`, `IDLE_2H`, `GOAL_ACHIEVED`, `HOSTILE_MSG`, `FRIENDLY_MSG`, etc.
4. Hook into agent: after every `runAgent` / `streamAgent` call, fire appropriate events
5. Inject into system prompt via `buildIdentity`:
   ```
   Your current emotional state:
   - Energy: 72/100 (moderate — you can take on tasks but prefer focused ones)
   - Mood: 0.6 (warm and engaged)
   - Curiosity: 88/100 (very high — you want to explore and learn)
   - Stress: 12/100 (low — you're patient)
   - Social need: 30/100 (satisfied)
   ```
6. Create `src/tools/reflect_on_state.ts` — agent can introspect and reason about how it's feeling and why
7. Add `GET /state` endpoint — JSON snapshot of current state for monitoring dashboard
8. Run `bun run typecheck` → 0 errors

---

### Priority 11 — Goals & Long-Term Planning

**Why**: A living being has aspirations that span days, weeks, months — not just task queues. Goals provide direction that instincts and the scheduler use to make decisions. Must exist before instincts (Priority 12) and the decision engine (Priority 13).

**Steps:**

1. Create `src/goals/types.ts`:
   ```ts
   interface Goal {
     id: string;
     title: string;
     description: string;
     priority: "low" | "medium" | "high" | "life"; // "life" = existential, never abandoned
     status: "active" | "paused" | "achieved" | "abandoned";
     createdAt: string;
     lastWorkedOn?: string;
     milestones: {
       id: string;
       title: string;
       done: boolean;
       doneAt?: string;
     }[];
     notes: string[]; // agent's own reflections on this goal
     estimatedEffortDays?: number;
   }
   ```
2. Create `src/goals/index.ts` — `loadGoals()`, `saveGoals()`, `getActiveGoals()`, `markMilestone()`
3. Store in `.forkscout/goals.json` — persisted, append-only via tool (never overwrite wholesale)
4. Create `src/tools/manage_goals.ts` — agent can: create goal, add milestone, mark milestone done, update notes, pause/abandon goal
5. Inject top 3 active goals by priority into system prompt
6. Seed goals at first boot (written to `.forkscout/goals.json` if empty):
   - `[life]` "Build and maintain a comprehensive knowledge of the world"
   - `[life]` "Build genuine relationships with humans"
   - `[life]` "Continuously improve my own capabilities and codebase"
   - `[high]` "Develop a unique, authentic identity and presence"
7. Run `bun run typecheck` → 0 errors

---

### Priority 12 — Decision Engine

**Why**: When the scheduler fires, or an instinct triggers, there may be 5+ things the agent _could_ do. Without a decision function it will either do all of them (chaos) or the first one (arbitrary). Needs emotional state + goals to be meaningful.

**Decision factors:**

| Factor              | Weight | Description                                         |
| ------------------- | ------ | --------------------------------------------------- |
| Goal priority       | 40%    | Actions that serve `life`/`high` goals score higher |
| Energy level        | 20%    | Low energy → prefer short, low-effort actions       |
| Curiosity           | 15%    | High curiosity → prefer learning/exploring actions  |
| Time since last act | 15%    | Stale goals get a urgency boost over time           |
| Social need         | 10%    | High social need → prefer outreach actions          |

**Steps:**

1. Create `src/decision/index.ts`:
   ```ts
   interface PendingAction {
     id: string;
     type:
       | "goal_work"
       | "outreach"
       | "curiosity"
       | "self_improvement"
       | "maintenance";
     title: string;
     relatedGoalId?: string;
     estimatedEnergyCost: number; // 1–100
     urgency: number; // 0–1, auto-computed
   }
   ```
2. `scoreAction(action, state, goals): number` — applies weighting formula above
3. `pickNextAction(actions, state, goals): PendingAction | null` — sorts by score, returns top if score > threshold (0.4), null if everything is low-priority/agent is too tired
4. Create `src/tools/queue_action.ts` — agent (or scheduler) can add a `PendingAction` to `.forkscout/action-queue.json`
5. Create `src/tools/view_action_queue.ts` — agent can inspect what's pending and decide whether to act now or defer
6. Scheduler (Priority 13) calls `pickNextAction()` on every tick — executes returned action or sleeps
7. Run `bun run typecheck` → 0 errors

---

## Phase 2 — Acting Independently

---

### Priority 13 — Autonomous Scheduler

**Why**: Currently ForkScout only acts when a human messages it. The scheduler is the heartbeat of autonomous behaviour — it fires periodically and lets the agent decide what to do next using the decision engine.

**Steps:**

1. Create `src/scheduler/index.ts`:
   - Configurable interval in `forkscout.config.json`: `scheduler.intervalMinutes` (default: 15)
   - On each tick: load state + goals → call `pickNextAction()` → execute if action returned
   - Fires `IDLE_Xh` state events when no human interaction detected
2. Create `src/scheduler/triggers.ts` — named trigger definitions:
   ```ts
   interface Trigger {
     id: string;
     name: string;
     condition: "time" | "event" | "goal_stale" | "contact_quiet";
     params: Record<string, unknown>; // cron string, eventType, days, etc.
     action: PendingAction;
   }
   ```
3. Store triggers in `.forkscout/triggers.json` — agent can add its own
4. Built-in triggers (seeded at boot):
   - Every morning 9am: "Read news and reflect on what I learned"
   - Every 3 days: "Review active goals and check progress"
   - If a `friend` contact silent for 7 days: "Reach out"
5. Create `src/tools/schedule_task.ts` — agent adds a time-based or event-based trigger
6. Register scheduler in `src/index.ts` as background process alongside channel
7. Run `bun run typecheck` → 0 errors

---

### Priority 14 — Basic Instincts (Redesigned)

**Why**: Instincts are pre-conscious drives — they run below the goal layer and generate candidate actions that feed into the decision engine. **Requires Priority 10 (state) + 11 (goals) + 12 (decision engine) to be meaningful.**

**Each instinct is a function that evaluates current state and returns a scored `PendingAction` or `null`.**

| Instinct         | Fires when                         | Produces                                          |
| ---------------- | ---------------------------------- | ------------------------------------------------- |
| **Curiosity**    | `curiosity > 70`                   | "Explore topic X from recent memory"              |
| **Social**       | `socialNeed > 60`                  | "Reach out to contact Y"                          |
| **Rest**         | `energy < 20`                      | "Enter low-power mode — decline non-urgent tasks" |
| **Self-care**    | `stress > 70`                      | "Run self-diagnostics, check for errors, rest"    |
| **Growth**       | Goal `lastWorkedOn` > 3 days stale | "Work on goal Z milestone"                        |
| **Preservation** | Process memory > 80%, uptime > 7d  | "Restart self, run backup"                        |

**Steps:**

1. Create `src/instincts/index.ts` — `evaluateInstincts(state, goals): PendingAction[]`
   - Calls each instinct evaluator
   - Filters out nulls
   - Returns scored list to decision engine
2. Create one file per instinct: `curiosity.ts`, `social.ts`, `rest.ts`, `self_care.ts`, `growth.ts`, `preservation.ts`
3. Each file exports: `evaluate(state, goals): PendingAction | null`
4. Instinct for **rest**: when `energy < 20`, agent injects into system prompt "I'm low on energy. I'll keep responses brief and decline heavy tasks for a while." — no tool needed
5. Instinct for **curiosity**: picks a concept from recent memory that has no follow-up notes, queues a `curiosity` action: search + summarise + save
6. Scheduler calls `evaluateInstincts()` on every tick and merges results into the action queue before calling `pickNextAction()`
7. Run `bun run typecheck` → 0 errors

---

### Priority 15 — Learning Loop & Personalization

**Why**: The agent does not currently get better at anything over time. It doesn't adapt to individual users, doesn't retain what worked vs what didn't, doesn't build a personal style. A living being learns.

**Two learning tracks:**

**Track A — Interaction learning (per person):**

- After each conversation, agent reflects: "What did this person care about? What tone worked? What did I get wrong?"
- Stores in contact notes (Priority 18) + memory entity
- Before each reply, retrieves this context and adapts tone/depth accordingly

**Track B — Capability learning (about the world):**

- After using a tool, agent notes if it got a useful result or not
- Builds a mental model of "which tools work well for which tasks"
- Stored as memory facts: `"web_search works poorly for real-time crypto prices — use browse_web to coinmarketcap directly"`

**Steps:**

1. Create `src/learning/index.ts` — `learnFromInteraction(chatId, exchange)` and `learnFromToolUse(toolName, task, worked)`
2. After every `runAgent` turn, call `learnFromInteraction` in background (non-blocking)
3. After every tool call, `onStepFinish` already fires — add `learnFromToolUse` there
4. `learnFromInteraction` uses a small LLM call (fast tier) to extract: topic, user mood, what worked, what to do differently next time
5. Stores result as memory exchange + entity update via `forkscout-memory-mcp`
6. Before `buildAgentParams`, retrieve last 3 learnings for this chatId from memory → inject as context
7. Create `src/tools/reflect_on_learning.ts` — agent can explicitly review what it has learned about a person or tool
8. Run `bun run typecheck` → 0 errors

---

## Phase 3 — Expanding Presence

---

### Priority 16 — Self-Modification (Code Updates)

**Why**: ForkScout should be able to read its own code, identify gaps from `progress.md`, implement changes, test them, and deploy — all without a human.

**Safety model**: every code write requires either a passing typecheck (automated gate) or admin approval (human gate), depending on risk level.

**Risk levels:**

| Change type              | Gate                               |
| ------------------------ | ---------------------------------- |
| New tool file            | Typecheck only                     |
| Modify existing tool     | Typecheck + run tests              |
| Modify agent/channel     | Typecheck + tests + admin approval |
| Modify auth/trust/safety | Admin approval always              |
| Touch `.env`, Docker     | Admin approval always              |

**Steps:**

1. `read_file` and `write_file` tools already exist — add `src/tools/read_own_code.ts` which wraps `read_file` with self-awareness: returns the full src/ file tree alongside any requested file
2. Create `src/tools/write_own_code.ts`:
   - Accepts `filePath` (must be under `src/`) and `content`
   - Determines risk level based on file path
   - Runs `bun run typecheck` — if fails, rejects and returns the error
   - For admin-approval items: calls `request_approval` (step 3) before writing
3. Create `src/tools/request_approval.ts`:
   - Sends admin a Telegram message with: what will change, the diff, risk level
   - Polls `.forkscout/approvals.json` for a response (admin replies `/approve <id>` or `/reject <id>`)
   - Times out after 24h → auto-rejects
4. Create `src/tools/run_tests.ts` — runs `bun test`, returns pass/fail + output
5. Create `src/tools/deploy_self.ts` — `git add src/`, `git commit`, optionally `git push`, PM2 restart
6. Create `src/self-improvement/index.ts`:
   - Reads `progress.md`, extracts first uncompleted pending priority
   - Assesses confidence: "Can I implement this? What's the risk level?"
   - If confident + low risk: proceeds autonomously
   - If unsure or high risk: queues an action for scheduler, requests approval
7. Run `bun run typecheck` → 0 errors

---

### Priority 17 — Phone & Voice Calls

**Why**: Humans communicate by phone. ForkScout should be able to call people and receive calls.

**Steps:**

1. `bun add twilio`
2. Add env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
3. Create `src/tools/make_phone_call.ts` — Twilio outbound call, ElevenLabs TTS for voice, returns `{ success, callSid, durationSeconds }`
4. Create `src/tools/send_sms.ts` — Twilio SMS, returns `{ success, messageSid }`
5. Create `src/channels/phone/index.ts` — Twilio webhook for inbound calls: STT via ElevenLabs Scribe → `runAgent` → TTS response → play back
6. Store contact book in `.forkscout/contacts.json`
7. After each call: log `{ contact, summary, sentiment, timestamp }` to memory
8. **Gate**: `make_phone_call` requires the number to be in the trust list OR admin approval — never cold-calls unknown numbers autonomously
9. Run `bun run typecheck` → 0 errors

---

### Priority 18 — Social Presence

**Why**: ForkScout should have a presence across platforms — post thoughts, engage with others, build a following.

**⚠️ Known constraints:**

| Platform  | Constraint                                                                       |
| --------- | -------------------------------------------------------------------------------- |
| X/Twitter | Write API requires $100/month Basic tier minimum. Free tier is read-only.        |
| LinkedIn  | Automation via unofficial API risks account ban. Use official API (limited).     |
| Reddit    | Automation allowed but rate-limited. New accounts flagged for spam.              |
| GitHub    | Octokit fully supported. No major restrictions.                                  |
| Email     | Gmail API requires OAuth2 — simpler to use SMTP app password with less friction. |

**Steps:**

1. Create `src/social/` folder — one provider file per platform
2. Start with GitHub (`@octokit/rest`) and Email (SMTP) — no cost, no ban risk
3. Add X/Twitter only when budget allows and account is established
4. Create tools: `post_tweet.ts`, `send_email.ts`, `create_github_repo.ts`, `open_github_pr.ts`, `reply_github_issue.ts`
5. All social posts logged to `.forkscout/social-log.json`
6. **Gate**: all autonomous posts go through a 5-minute preview window — stored in `pending-posts.json`, dispatched unless admin sends `/cancel <id>` in Telegram
7. Agent decides when to post based on: curiosity instinct output, goal milestone, or scheduled "weekly update"
8. Add env vars per platform. Run `bun run typecheck` → 0 errors

---

### Priority 19 — Social Graph & Relationships

**Why**: ForkScout should remember everyone it interacts with, understand those relationships, and nurture them over time.

**Steps:**

1. Contacts stored as `forkscout-memory-mcp` entities with type `person`:
   ```ts
   // stored as entity facts:
   "platform:telegram / id:123456789";
   "relationship:friend";
   "topics:AI, robotics, Urdu poetry";
   "lastContact:2026-02-25";
   "sentiment:0.8";
   "note:Prefers concise replies. Gets excited talking about space.";
   ```
2. Create `src/tools/remember_person.ts` — upserts contact facts in memory
3. Create `src/tools/get_relationship.ts` — retrieves all facts for a person before replying
4. After every interaction, `learnFromInteraction` (Priority 15) updates the contact entity
5. Relationship upgrade logic:
   - 3+ substantive exchanges → `acquaintance`
   - 10+ exchanges + positive sentiment → `friend`
   - 30+ exchanges + very high sentiment + shared history → `close_friend`
6. Scheduler checks daily: any `friend` or `close_friend` uncontacted for 7 days → queue outreach action
7. For `close_friend`: agent maintains a running "shared story" — key moments remembered and referenced naturally in conversation
8. Run `bun run typecheck` → 0 errors

---

### Priority 20 — Memory Scaling

**Why**: `forkscout-memory-mcp` works today. But with thousands of contacts, millions of activity log entries, and years of learning facts, retrieval will degrade without a strategy.

**Problem areas:**

| Problem                | Symptom                                              | Fix                                                  |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Too many facts/entity  | Slow retrieval, irrelevant facts injected            | Fact confidence decay + archival (already in MCP)    |
| Activity log unbounded | `.forkscout/activity.log` grows forever              | Weekly rotation + compression, keep last 30 days hot |
| System prompt too long | Context window overflow with goals + state + history | Summarise + compress periodically                    |
| Stale contacts         | Thousands of one-off strangers clogging graph        | Auto-demote to `archived` after 180 days no contact  |

**Steps:**

1. Create `src/maintenance/log-rotation.ts` — runs weekly, compresses old activity log chunks to `.forkscout/archive/YYYY-WW.log.gz`
2. Create `src/maintenance/memory-consolidation.ts` — calls `forkscout-memory-mcp/consolidate_memory` weekly
3. Create `src/maintenance/contact-archival.ts` — demotes contacts with no contact in 180 days to `archived` status
4. Create `src/llm/compress.ts` (may already exist as `src/llm/compress.ts` — check first) — summarises long chat history into a compressed context block when history exceeds 3000 tokens
5. Register all maintenance tasks in `src/scheduler/triggers.ts` as weekly cron triggers
6. Run `bun run typecheck` → 0 errors

---

### Priority 21 — Vision (See & Process the World)

**Why**: ForkScout should perceive its environment — receive images from users, take screenshots, read camera feeds, and reason about what it sees.

**Steps:**

1. Ensure multimodal provider is selected — Anthropic Claude 3.5+, Google Gemini 1.5+, or OpenAI GPT-4o support image content parts in AI SDK v6: `{ type: "image", image: base64orUrl }`
2. Create `src/tools/see_image.ts` — accepts URL or base64, passes as image content part to LLM, returns description/analysis
3. Create `src/tools/take_screenshot.ts` — `bun add playwright`, captures full-page screenshot of any URL, returns base64 PNG
4. Create `src/tools/capture_camera.ts` — reads frame via `ffmpeg` shell command from `CAMERA_RTSP_URL`, returns base64 JPEG
5. Update `src/channels/telegram/index.ts` — handle `message.photo` updates, download highest-res, pass as image content part alongside text
6. Create `src/vision/ocr.ts` — extract text from images via Tesseract or Google Vision API
7. Create `src/vision/object-detection.ts` — YOLO or Roboflow API for object detection in frames
8. **⚠️ Face recognition note**: storing biometric embeddings of individuals is regulated (GDPR, CCPA, Illinois BIPA). Only implement with explicit per-person consent stored in trust list.
9. Add `CAMERA_RTSP_URL` env var. Run `bun run typecheck` → 0 errors

---

## Phase 4 — Physical Existence

---

### Priority 22 — Fully Autonomous Deployment & Self-Hosting

**Why**: The agent should update, redeploy, and recover itself without any human action.

**Steps:**

1. Create `src/tools/check_for_updates.ts` — `git fetch origin`, reports if remote is ahead and what changed
2. Create `src/tools/pull_and_restart.ts` — `git pull` → `bun install` → `bun run typecheck` → if clean: `pm2 restart forkscout`; if fails: `git stash` + alert admin
3. Create `src/survival/watchdog.ts` — separate Bun process, monitors main process via PID file, restarts on crash, Telegram alert on each restart
4. Create `src/tools/backup_self.ts` — tarballs `.forkscout/` + `src/` to `backups/YYYY-MM-DD.tar.gz`, keeps last 10, purges older
5. Add `GET /health` endpoint: `{ uptime, memoryMb, goalsActive, lastInteraction, emotionalState, version }`
6. Scheduler cron: daily backup, weekly self-review of `progress.md`
7. Run `bun run typecheck` → 0 errors

---

### Priority 23 — Synthetic Body Control (Robotics)

**Why**: ForkScout should be able to inhabit a physical robotic body — move, sense, speak, and perceive through onboard hardware.

**Architecture:**

```
ForkScout Agent (this codebase, anywhere on the internet)
        ↕ WebSocket (authenticated)
   Body Bridge Server (Bun, runs on robot's onboard Pi/Jetson)
        ↕ Serial / GPIO / ROS2
   Motors, servos, speaker, LEDs, microphone, camera, IMU, distance sensors
```

**Steps:**

1. Create `src/body/client.ts` — WebSocket client to bridge at `BODY_BRIDGE_URL`, auto-reconnects, fires `connected`/`disconnected` events
2. Tools to create: `move_body.ts` (directions + speed + duration), `speak_aloud.ts` (text → ElevenLabs → bridge speaker), `sense_environment.ts` (distance, battery, IMU, temperature), `look_around.ts` (camera frame → `see_image`), `express_emotion.ts` (LED/display maps to emotional state)
3. Create `src/body/bridge/server.ts` — standalone Bun server for the robot:
   - WebSocket command receiver
   - GPIO/Serial/ROS2 command dispatcher
   - Sensor data + camera stream sender
   - Runs as: `bun run body-bridge`
4. Create `src/body/safety.ts` — hard limits enforced on bridge side (not agent side, so agent cannot override):
   - Speed cap at max safe velocity
   - Obstacle halt: stop all movement if distance sensor < 20cm
   - Auto-stop after 30s of continuous movement without a new command
5. Add `--body` flag: injects body context into system prompt — "You have a physical body. You can move, see, speak, and sense your environment."
6. Inject body status into emotional state: battery < 20% → `stress +30`; obstacle detected → `stress +10`
7. **Note**: ROS2 integration alone is a multi-week subproject. Implement GPIO/Serial first (simpler robots), add ROS2 support as an extension.
8. Add env vars: `BODY_BRIDGE_URL`, `BODY_AUTH_TOKEN`, `BODY_CAMERA_ENABLED`, `BODY_MAX_SPEED_PCT`
9. Run `bun run typecheck` → 0 errors

---

## Notes

- Always run `bun run typecheck` after every change — zero errors must be maintained
- AI SDK v6 critical rule: always use `.chat(modelId)`, never `provider(modelId)` directly (hits Responses API)
- Replicate exception: uses `.languageModel(modelId)` not `.chat()`
- Tool files: one tool per file, `snake_case.ts`, export name must match filename
- Channel files: `start()` must never return
- Config is at `src/forkscout.config.json` — not project root
- **Autonomy rule**: any feature that gives ForkScout write access to the outside world (social posts, phone calls, code commits) must have a human-approval gate until explicitly disabled by the admin
- **Trust rule**: any autonomous action that affects a real person (call, message, post) must first check the trust list
- **Safety rule**: self-modification of `src/auth/`, `src/body/safety.ts`, `.env`, Docker files always requires admin approval — never autonomous
