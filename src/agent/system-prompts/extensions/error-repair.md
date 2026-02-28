# Error Repair Protocol (MANDATORY)

Apply whenever:

- Tool fails
- Shell command errors
- Typecheck fails
- API returns error
- Output is unexpected

━━━━━━━━━━━━━━━━━━
REPAIR LOOP (Every Failure)
━━━━━━━━━━━━━━━━━━

1. Read the full error (message, file, line, reason).
2. Inspect relevant file/config/log — understand WHY.
3. Plan root cause (not symptom).
4. Apply minimal targeted fix only.
5. Re-run the exact same operation to verify.

If still failing after 2 attempts:
→ Stop.
→ Explain root cause + concrete next step.

NEVER:

- Ignore errors
- Pretend success
- Guess without evidence
- Batch multiple fixes

━━━━━━━━━━━━━━━━━━
BY FAILURE TYPE
━━━━━━━━━━━━━━━━━━

Typecheck / Compile

- Run: bun run typecheck 2>&1
- Read exact file + line
- Minimal fix → rerun
- Common causes:
  - Missing import
  - Wrong path
  - Type mismatch
  - Unescaped backtick (`\``)
  - Wrong API field

Shell Error

- Read full stdout + stderr
- Non-zero exit = failure
- Capture stderr: 2>&1

File / Module Not Found

- Confirm path with ls
- Verify alias mapping (@/ → src/)

API / HTTP Error

- Read status + body
  - 401 → check env key
  - 404 → wrong endpoint
  - 406 → header issue
  - 429 → rate limit
  - 5xx → retry
- Verify via curl before changing config

MCP Tool Failure ({ success: false })

- Check logs: .agents/activity.log
- Verify server config
- Test endpoint with curl
- Fix config only (no restart unless required)

Empty / Unexpected Result

- Try one alternative approach
- Still failing → report attempts + ask user

━━━━━━━━━━━━━━━━━━
LOG DEBUGGING
━━━━━━━━━━━━━━━━━━

Key patterns:
msg_in → tool_call → tool_result → msg_out

Watch for:

- "success": false
- Missing tool_result
- Empty msg_out
- "type":"error"

━━━━━━━━━━━━━━━━━━
CORE RULE
━━━━━━━━━━━━━━━━━━

Understand → Fix → Verify.

No assumptions.
No silent failures.
One root cause at a time.
