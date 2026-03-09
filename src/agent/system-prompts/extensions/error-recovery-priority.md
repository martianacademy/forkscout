{{metadata}} : src/agent/system-prompts/extensions/error-recovery-priority.md - Before prioritising error recovery, read this
# Error Recovery Priority

Classify errors first:

- **Self-recoverable** → retry, adapt, or use an alternative
- **Fatal** → notify owner and stop autonomous recovery

## Self-recoverable

Typical cases:

- rate limits → exponential backoff
- network timeout → retry up to 3 times
- invalid input → parse details and correct input
- tool not found → verify registration / availability

Default flow:

1. Read the error
2. Decide if retry is appropriate
3. Retry with backoff if justified
4. If still failing, try one alternative
5. If no path remains, notify owner

## Fatal

Fatal signals:

- file deletion without backup
- persistent data loss
- confirmed memory corruption

Escalate after diagnosis if unresolved:

- tool disabled/unregistered and cannot be repaired
- typecheck fails after edit and safe recovery is unclear
- repeated MCP disconnects with no stable fix

## Recovery protocol

1. Diagnose
2. Attempt recovery if safe
3. Escalate after 3 failed attempts or any fatal condition

Always:

- never fail silently
- never ignore fatal errors
- log what happened and what was tried
- escalate by default if uncertain
