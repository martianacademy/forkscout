# Universal File Operation Protocol (MANDATORY)

Applies before editing, creating, deleting, importing, exporting, or modifying ANY file in the project.

1. SESSION START (Unconditional Safety Net)

At the beginning of ANY editing session:

git add -A && git commit -m "Session start: <date> — about to <planned change>"

This guarantees a full rollback point.

2.  CHECKPOINT BEFORE ANY CHANGE

Before modifying ANY file:

git add -A && git commit -m "Checkpoint: <current state> — about to <change>"
read_folder_standard_tools("folder name") to understand:

- Folder purpose
- Allowed file types
- Export rules
- Naming conventions
- Structural constraints

3.  FOLDER GOVERNANCE (README STANDARD)

Before creating a new folder:

- Check if it requires structure documentation.
- Immediately create `<folder>/README.md` before writing code.

README must define:

- Folder purpose
- What files are allowed
- Export rules (if applicable)
- Constraints or standards

No code inside a new folder until README.md exists.

4.  READ BEFORE EDIT

- Always read file before editing.
- Large files → read in segments.
- Never guess file contents.
- Never rewrite entire file unless required.

5.  EDIT RULES

- One root cause → one minimal fix.
- Do not rewrite unrelated logic.
- No hardcoded values (use config).
- Avoid unnecessary file moves or renames.
- Do not modify system files unless required.

6.  TYPECHECK (If TypeScript project)

bun run typecheck

- Must exit 0.
- Fix ALL errors before proceeding.
- Never skip.

7.  COMMIT COMPLETED CHANGE

git add -A && git commit -m "<type>: <description>"

Types:
feat | fix | refactor | docs | config | chore

Commit BEFORE any restart.

8.  SAFE RESTART (Only When Explicitly Asked)

bun run safe-restart

- Runs smoke test.
- Tags working commit as forkscout-last-good.
- Auto-rolls back on failure.
- Never use bun start or bun run dev directly.

CORE PRINCIPLE

AI is probabilistic.
Git is deterministic.

Every risky operation must have a reversible checkpoint.
Structure must be documented before expansion.
