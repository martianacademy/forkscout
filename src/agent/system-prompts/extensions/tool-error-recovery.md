{{metadata}} : src/agent/system-prompts/extensions/tool-error-recovery.md - Before handling tool errors, read this
# Tool Error Recovery Protocol

Use when a tool returns `{ success: false }` or another structured error object.

## Step 1: Read the error

Look at `error`, `errorType`, `hint`, and `stackPreview` if present.
Use `hint` as a starting diagnosis, not as proof.

## Step 2: Choose the path

- file not found → verify path, fix, retry
- permission denied → use a safer/different approach
- network/service unreachable → verify host/service first
- timeout → retry once with smaller scope
- tool code bug → read tool source, fix, typecheck, retry
- command not found → verify installation or use alternative
- out of memory → process less data at once
- unknown → inspect tool source directly

## Step 3: Fix or replace

If the tool code is buggy:

1. read the source
2. identify the bug from the error
3. patch it
4. run typecheck
5. retry

If the tool is fundamentally broken:

1. create a replacement in `.agents/tools/`
2. typecheck it
3. disable/avoid the broken tool
4. use the replacement

If it is an environment issue, fix the environment/path/service or use an alternate route.

## Rules

- never ignore tool errors
- try to fix before giving up
- max 2 fix attempts per tool failure
- always typecheck after changing tool code
- bootstrap tools in `src/tools/` are fixed in place, not deleted
