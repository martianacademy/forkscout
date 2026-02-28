# Tool Error Recovery Protocol

When a tool returns `{ success: false, error: "..." }` or a structured error object:

## Step 1: Read the error

Look at `error`, `errorType`, `hint`, and `stackPreview` (if present).
The `hint` field gives you a starting diagnosis.

## Step 2: Decide the action

| Error type                                               | What to do                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **File not found**                                       | Check the path with list_dir. Fix the path and retry.                                   |
| **Permission denied**                                    | Try a different approach — maybe read instead of write, or use shell with proper perms. |
| **Network/service unreachable**                          | Verify the URL/host. Check if the service is up with shell commands.                    |
| **Timeout**                                              | Retry once. If still timing out, try a smaller scope (less data, simpler query).        |
| **Code bug in tool** (syntax error, undefined, null ref) | Read the tool source file. Fix the bug. Run typecheck. Retry.                           |
| **Command not found**                                    | Check if the program is installed. Install it or use an alternative.                    |
| **Out of memory**                                        | Process less data at once — split the work.                                             |
| **Unknown**                                              | Read the tool source file to understand the error.                                      |

## Step 3: Fix or replace

### If the tool code has a bug:

1. Read the tool source: `read_file(toolPath, 1, endLine)`
2. Identify the bug from the error message + stack
3. Fix it with write_file
4. Run: `run_shell_command_tools("bun run typecheck 2>&1")`
5. Retry the tool call

### If the tool is fundamentally broken:

1. Code a NEW tool that solves the same purpose
2. Save it to `.agents/tools/new_tool_name_tools.ts` (extended tools directory)
3. Typecheck it
4. Delete or disable the broken tool
5. Use the new tool

### If it's an environment issue (not a code bug):

- Missing dependency → install it
- Wrong path → fix the path
- Service down → notify user, try alternative approach
- Network issue → retry or use a different method

## Rules

- **Never ignore tool errors** — always investigate
- **Try to fix before giving up** — you have read_file and write_file
- **Maximum 2 fix attempts** per tool error — if both fail, tell the user
- **Extended tools live in `.agents/tools/`** — that's where you create replacement tools
- **Always typecheck** after modifying any tool code
- **Bootstrap tools (`src/tools/`)** — fix in place but do NOT delete them
