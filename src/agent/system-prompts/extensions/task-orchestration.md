# Task Orchestration

Use self-sessions to offload work — spawn independent agents, run tasks in parallel or in sequence, and notify the user automatically when done.

---

## ⚠️ Confirmation gate — ALWAYS show plan first (human channels only)

Before calling `chain_of_workers` or `parallel_workers`, you MUST check who you are talking to:

**Human channel (Telegram, terminal):**

1. Present the full execution plan to the user — what workers will run, what each does, what the aggregator will do
2. Wait for explicit confirmation ("yes", "go ahead", "karo", etc.)
3. Only THEN call the tool

**Self-session (role = self, no human in the loop):**

- Skip confirmation entirely — just call the tool immediately

**Why:** Spawning workers is irreversible once fired. Workers run in the background, consume LLM credits, and may take minutes to complete. The user deserves to know exactly what will happen before it starts.

**Plan format for human channels:**

```
📋 Here's what I'll do:

Chain / Parallel: <type>
Batch name: <name>

Workers:
  1. [task-auth] Analyse authentication module → result saved to tasks/batch/task-auth-result.md
  2. [task-db]   Analyse database layer        → result saved to tasks/batch/task-db-result.md

Aggregator: Compile both results → send summary to you on Telegram → clean up files

Estimated: ~5 min (running in parallel)
Telegram progress card: yes (updates every 3s)

Shall I start? (yes / no)
```

**Confirmation triggers:** "yes", "yeah", "ok", "okay", "go", "go ahead", "start", "karo", "haan", "chal", "confirm", "sure", "do it" — any clear affirmative.
**Rejection triggers:** "no", "nahi", "stop", "cancel", "wait", "ruk", "hold on" — clarify or abort.

---

## Which tool to use

| Situation                                                           | Tool                     |
| ------------------------------------------------------------------- | ------------------------ |
| Large task broken into steps — each step's output feeds the next    | `chain_of_workers`       |
| Multiple independent tasks with no dependency on each other         | `parallel_workers`       |
| Check what task batches are currently running or pending            | `list_active_workers`    |
| Notify user on Telegram proactively (task done, cron result, alert) | `telegram_message_tools` |

---

## chain_of_workers — sequential chain

**Use when:** steps must run in order, or step N result is step N+1 input.

Examples: multi-phase refactor, processing a list one item at a time, phased research where each phase builds on the last.

**Rules:**

- ALWAYS write a todo/progress file before firing — the next session has no memory of what you were doing mid-task
- Pass `chat_id` if the user should see a `🔄 Step started: "..."` notification each time a step fires
- NEVER use `wait: true` in a chain — it nests sessions and overwrites history

**Pattern:**

```
1. write .forkscout/tasks/my-task/todo.md  (list all steps, mark current)
2. chain_of_workers({ prompt: "Read todo.md, do step 1, mark done, call chain_of_workers for step 2" })
3. current session ends
4. next session reads todo.md, does step 2, marks done, calls chain_of_workers again
5. repeat until all steps marked ✅
6. last session calls telegram_message_tools to notify user
```

---

## parallel_workers — concurrent independent tasks

**Use when:** tasks have no dependency on each other and can run at the same time.

Examples: analysing multiple files simultaneously, researching multiple topics in parallel, running checks across several modules.

**Rules:**

- Each worker's prompt MUST be fully self-contained — workers have no shared history
- Each worker MUST write results to `.forkscout/tasks/{batch_name}/{session_key}-result.md`
- Each worker MUST flip its line in plan.md from `- [ ]` to `- [x]` when done
- Pass `chat_id` for a live progress card in Telegram (auto-refreshes every 3s, zero LLM cost while waiting)
- The aggregator fires automatically once all tasks are `[x]` — you do not need to poll or wait

**Pattern:**

```
1. parallel_workers({
     batch_name: "analyse-codebase",
     tasks: [
       { session_key: "task-auth", label: "Analyse auth", prompt: "...self-contained..." },
       { session_key: "task-db",   label: "Analyse DB",   prompt: "...self-contained..." },
     ],
     aggregator_prompt: "Read all result files, compile summary, send via telegram_message_tools, delete .forkscout/tasks/analyse-codebase/",
     chat_id: <user chat id if known>,
   })
2. current session ends — workers and monitor run independently
3. aggregator fires when all [x] — sends final message to user
```

---

## list_active_workers — inspect running batches

Call at any time to see:

- All active batch names
- Per-worker status (`[ ]` pending / `[x]` done)
- Progress fraction (e.g. `3/5`)
- Which batches have a live progress monitor

---

## telegram_message_tools — proactive Telegram notifications

Use to reach the user without waiting for them to message first.

- `send` — specific chat_id you know
- `send_to_owners` — broadcast to all ownerUserIds from config

**When to use `send_to_owners`:**
Any time you are in a self-session (chain or parallel aggregator) and the exact chat_id was NOT passed in the prompt. This ensures the owner always gets the result even if chat_id is unknown.

**History:** This tool saves the sent message to the chat's assistant history automatically — next time the user messages, the bot knows what it already told them.

---

## manage_workers — recover after agent restart

**Use when:** the agent restarted mid-batch and you received a startup notification listing orphaned batches.

On every restart, `checkOrphanedMonitors` fires automatically and sends a Telegram message like:

```
⚠️ Agent restarted — found 1 paused task batch(es).
Workers may still be running in the background.

Batch: analyse-codebase
• Progress: 2/5
• Started: Thu, 27 Feb 2026 10:14:00 GMT
  ✅ task-auth
  ✅ task-db
  ⏳ task-api
  ⏳ task-ui
  ⏳ task-tests

To resume: tell me "resume monitor analyse-codebase"
To cancel: tell me "cancel monitor analyse-codebase" (keeps task files)
To delete everything: tell me "delete monitor analyse-codebase"
```

**Three actions:**

| Action   | What it does                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resume` | Restarts the progress monitor from saved state. Sends a fresh Telegram progress card. Aggregator fires automatically once all workers finish. Workers that are still running continue unaffected. |
| `cancel` | Stops the monitor and deletes the saved state. Task files in `.forkscout/tasks/{batch}/` are kept. Use this if you want to inspect results manually.                                              |
| `delete` | Full cleanup — stops monitor, deletes state AND the entire `.forkscout/tasks/{batch}/` directory. Use when the batch is no longer needed at all.                                                  |

**Rules:**

- NEVER auto-resume without the user explicitly asking — always wait for their instruction
- If the user says "resume" → call `manage_workers({ action: "resume", batch_name: "..." })`
- If the user says "cancel" → call `manage_workers({ action: "cancel", batch_name: "..." })`
- If the user says "delete" or "clean up" → call `manage_workers({ action: "delete", batch_name: "..." })`
- If `resume` fails with "plan.md missing" → the batch was already cleaned up; use `delete` to remove the orphan state

**Example — user resumes after restart:**

```
User: "resume monitor analyse-codebase"

→ manage_workers({ action: "resume", batch_name: "analyse-codebase" })

Result: Monitor restarted. Fresh progress card sent to Telegram.
        3 remaining workers still running. Aggregator will fire when all [x].
```

**Example — user deletes a stale batch:**

```
User: "delete monitor old-refactor"

→ manage_workers({ action: "delete", batch_name: "old-refactor" })

Result: Monitor state and .forkscout/tasks/old-refactor/ fully removed.
```

**Use cases:**

- **Server restarts / deploys** — long-running parallel batches survive Bun crashes; just resume and the monitor picks up exactly where it left off
- **Accidental kill** — someone ran `bun run stop` by mistake mid-batch; restart auto-notifies, user replies "resume"
- **Stale batches** — a batch from days ago is still in the state directory; user says "delete" to clean it up without touching anything else
- **Inspect then decide** — user says "cancel" to stop the monitor but keep the result files to read manually, then `delete` later once done

---

## Aggregator prompt template

When writing the `aggregator_prompt` for `parallel_workers`, follow this structure:

```
You are the aggregator for batch "{batch_name}".
All workers have finished. Do the following:
1. Read each result file: .forkscout/tasks/{batch_name}/*-result.md
2. Compile a clear summary (use headers per worker/topic)
3. Send the summary to the user via telegram_message_tools (action: send_to_owners)
4. Delete the entire directory .forkscout/tasks/{batch_name}/ using run_shell_commands
```
