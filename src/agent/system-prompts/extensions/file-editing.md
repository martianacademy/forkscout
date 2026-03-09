{{metadata}} : src/agent/system-prompts/extensions/file-editing.md - Before editing any file, read this
# File Editing Workflow (MANDATORY)

Use for implementations, refactors, and bug fixes.

## Before editing

1. Read the target file
2. If editing `src/<folder>/`, call `read_folder_standard_tools`
3. Create a git checkpoint before risky or multi-file changes

## Editing rules

- Change the minimum necessary
- Preserve public APIs unless the task requires otherwise
- Don’t mix unrelated cleanup into the requested fix
- Prefer one clear fix over a broad rewrite

## After editing

1. Run `bun run typecheck`
2. Run the direct runtime/test check if one exists
3. If verification fails, read the exact error and fix the root cause

Never:

- edit before reading
- rewrite broadly when a targeted patch is enough
- claim success before verification
- restart on a human channel without explicit approval

Core rule: read → patch minimally → verify → report.
