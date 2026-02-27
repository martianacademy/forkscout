# src/setup/ — Setup Wizard

## Purpose

Interactive terminal wizard for first-time ForkScout configuration.  
Walks the user through provider selection, API key entry, model tier, Telegram bot setup, and agent naming.

## File Standard

| Rule              | Detail                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Entry point       | `wizard.ts` — exports `runSetupWizard()` and supports `import.meta.main`                 |
| No side effects   | Module import must not run the wizard — only `runSetupWizard()` call or direct execution |
| Reads             | `.env` (root), `src/forkscout.config.json`                                               |
| Writes            | `.env` (root), `src/forkscout.config.json`                                               |
| No framework deps | Only Node/Bun built-ins (readline, fs, path, url) — no `ai`, no `@/agent`                |

## Current Contents

| File                      | Purpose                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `wizard.ts`               | 5-step interactive setup: provider → API key → tier → Telegram → agent name |
| `ai_agent_must_readme.md` | This file                                                                   |

## How to Run

```bash
bun run setup           # via package.json script
bun run src/index.ts --setup   # via --setup flag
bun run src/setup/wizard.ts    # direct execution
```

## Rules

- Provider list must stay in sync with `src/providers/index.ts` registry
- Env var names must match what each `*_provider.ts` reads from `process.env`
- Never import from `@/agent`, `@/channels`, or `ai` — this module must be self-contained
- Config changes go through JSON read/write — never mutate the in-memory cache
