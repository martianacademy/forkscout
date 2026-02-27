# Error Repair Protocol

> Read this when: a tool fails, a shell command errors, typecheck fails, an API returns an error, or anything produces unexpected output.

---

## The Repair Loop (apply to EVERY failure)

1. **Read** the full error — message, file, line, reason
2. **Inspect** the relevant file/config/log — understand WHY before touching anything
3. **Plan** — identify root cause, not symptoms
4. **Fix** — minimal targeted change, nothing unrelated
5. **Verify** — re-run the exact same operation to confirm success
6. Still failing after 2 attempts → stop, explain root cause + concrete next step to user

**NEVER:**

- Accept a failure silently
- Pretend success when something errored
- Guess — use tools to get ground truth
- Batch multiple fixes — fix one root cause, verify, then continue

---

## By Failure Type

### Typecheck / compile error

```bash
bun run typecheck 2>&1
```

- Read file + line + reason exactly
- `read_file` at that exact line → find root cause
- Minimal fix → rerun typecheck
- Common causes:
  - Missing property → wrong API field (check `node_modules/ai/src/`)
  - `Cannot find name` → missing import or wrong scope
  - `Unexpected token` → unescaped backtick in template literal (use `\``)
  - `Module not found` → wrong path (use `list_dir` to confirm)
  - Type mismatch → both sides need the same type shape

### Shell command error

- Read full output including stderr
- Check exit code — non-zero = error
- `run_shell_commands` with `2>&1` to capture stderr too

### File not found / module not found

```bash
# Confirm path exists:
ls src/path/to/file.ts
# Check import alias:
# @/ maps to src/ — so @/tools/foo.ts → src/tools/foo.ts
```

### API / HTTP error

- Read status code + body — the body contains the reason
  - 401 → check `.env` for the correct key name
  - 404 → wrong endpoint or path param
  - 406 → wrong Content-Type or missing Accept header
  - 429 → rate limited — wait and retry
  - 5xx → server error — retry after delay
- Verify with curl before touching config:

```bash
curl -sv "URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{}' 2>&1 | tail -30
```

### MCP tool failure (`{ success: false, error: "..." }`)

```bash
# Read logs:
tail -50 .agents/activity.log | jq .
# Read server config:
cat src/mcp-servers/<server-name>.json
# Test connectivity:
curl -sv "URL" -H "Authorization: Bearer $KEY" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' 2>&1 | tail -20
```

- Fix the JSON config (secrets as `${ENV_VAR}`, correct header names)
- No restart needed — auto-discovery reconnects on next message

### Empty / unexpected result

- Try one alternative approach
- Still empty → report what was tried + ask user to unblock

---

## Log Reading

```bash
tail -50 .agents/activity.log | jq .           # last 50 events
grep '"type":"error"' .agents/activity.log | tail -20           # errors only
grep '"type":"tool_call"\|"type":"tool_result"' .agents/activity.log | tail -30  # tool trace
```

Trace pattern to look for:

```
msg_in → tool_call → tool_result → msg_out
```

Anomalies: `"success": false`, missing `tool_result`, empty `msg_out`, `"type":"error"` at startup
