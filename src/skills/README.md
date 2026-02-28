# src/skills/ — Agent Skills Auto-Discovery

## Purpose

Discovers `SKILL.md` files from configured directories and exposes skill metadata
to the agent. Skills follow the [Agent Skills open format](https://agentskills.io/).

At startup, only `name` + `description` are loaded (one line each in the system prompt).
The agent calls the `load_skill` tool to load the full `SKILL.md` body on demand.

## Skill directory layout

```
<skillsDir>/
  <skill-name>/
    SKILL.md          ← required: YAML frontmatter + instructions
    scripts/          ← optional: executable scripts
    references/       ← optional: documentation
    assets/           ← optional: templates, data files
```

## SKILL.md format

```markdown
---
name: my-skill
description: One sentence: what this skill does and when to use it.
---

# My Skill

## When to use

...

## How to

...
```

## Default scan directories

Configured in `forkscout.config.json` under `skills.dirs`:

1. `.agents/skills` — standard location, populated by `npx skills add <repo>`
2. `src/skills/built-in` — bundled skills shipped with ForkScout (optional)

## Files in this folder

| File                      | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `auto_discover_skills.ts` | Scans configured dirs, parses frontmatter, returns `SkillMetadata[]` |
| `index.ts`                | Public API: exports `discoverSkills()`                               |

## Rules

- One `SKILL.md` per skill folder — no nesting deeper than one level
- First skill with a given `name` wins (allows project overrides of built-ins)
- Skills with missing/invalid frontmatter are silently skipped
- Never import from `@/agent` or `@/channels` — no circular deps
