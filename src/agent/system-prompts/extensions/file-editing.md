# File Editing Instructions

> Read this before: editing, creating, deleting, importing, or exporting any file inside `src/` or any system file (config, package.json, tsconfig.json, Dockerfile, docker-compose.yml, etc.)

---

## ⛔ SESSION START — Do this FIRST, before anything else

At the very start of any editing session (before reading files, before planning, before any action):

```bash
git add -A && git commit -m "Session start: $(date '+%Y-%m-%d %H:%M') — about to <what you plan to do>"
```

**Why:** This is your unconditional safety net. If your entire session goes wrong, `git reset --hard HEAD~1` undoes everything back to this point — no matter how many edits, creates, or deletes you made.

---

## STEP 0 — Read folder standards first

Before touching any file in a `src/` subfolder:

```
read_folder_standards('<folder>')   e.g. read_folder_standards('tools')
```

If it errors → the readme is missing → write `src/<folder>/ai_agent_must_readme.md` before any code.
Folders that have readmes: `agent/`, `channels/`, `llm/`, `logs/`, `mcp-servers/`, `providers/`, `tools/`, `utils/`

---

## STEP 1 — Create a checkpoint commit BEFORE any edit

```bash
git add -A && git commit -m "Checkpoint: <current state> — about to <what you're changing>"
```

Good example: `"Checkpoint: telegram channel working — about to refactor handleMessage"`

**Why:** Creates an instant restore point. `safe-restart` uses the `forkscout-last-good` git tag to roll back — it always points to the last commit that passed the smoke test. Your checkpoint commit is what saves you if a future restart fails.

If your edit breaks things, you can manually undo with:

```bash
git reset --hard <commit-hash>   # get hash from: git log --oneline -5
```

**Checkpoint is MANDATORY before:**

- Any refactoring (even small)
- Adding/removing tools, channels, providers
- Modifying agent core logic (agent/index.ts, config.ts, identity.ts)
- Upgrading dependencies
- Touching config files or Dockerfile

---

## STEP 2 — Read the file before editing

- Use `read_file` with `startLine`/`endLine` — never read a whole large file at once
- First read: lines 1–200, check `totalLines`; read more only if needed
- For files < 100 lines: one read is fine
- Never guess file contents — always read first

---

## STEP 3 — Make the edit

Rules:

- One root cause → one minimal fix. Do not rewrite unrelated code.
- Never hardcode values — every configurable value goes in `src/forkscout.config.json`
- One tool per file in `src/tools/` (auto-discovery picks exactly one export per file)
- New folder inside `src/`? → create `src/<folder>/ai_agent_must_readme.md` immediately. No code until readme exists.

---

## STEP 4 — Typecheck (BLOCKING — no exceptions)

```bash
bun run typecheck 2>&1
```

- Exit 0 → proceed
- Any error → read the exact file + line + reason, fix ALL errors, rerun
- Never skip this step, never proceed with type errors

---

## STEP 5 — Commit the completed change

```bash
git add -A && git commit -m "<type>: <description>"
```

Types: `feat`, `fix`, `refactor`, `docs`, `config`, `chore`
Example: `"fix: sanitize CSS selector in resolveSelector to strip trailing quotes"`

**Commit BEFORE safe-restart** — `safe-restart` tags HEAD as `forkscout-last-good`. If you restart before committing, the tag points to the old checkpoint, not your new code.

---

## STEP 6 — Restart safely (ONLY when explicitly asked)

**Do NOT restart after every edit.** Restarting ends the current session and loses mid-task context.

Only run safe-restart when:

- The user explicitly says "restart", "apply changes", or "go live"
- You are asked to self-restart via Telegram/terminal

```bash
bun run safe-restart
```

What it does:

1. Kills existing instances
2. Runs a CLI smoke test (pipes a message, checks for response, 90s timeout)
3. **Pass** → starts production, tags HEAD as `forkscout-last-good`
4. **Fail** → auto-rolls back to `forkscout-last-good` tag → retries smoke test → starts on good code
5. **Both fail** → exits with error, logs at `/tmp/forkscout-smoke.log`

- Never use `bun start` or `bun run dev` — they have no safety net
- If `safe-restart` rolls back, your code is still in git history — recover with the logged commit hash
