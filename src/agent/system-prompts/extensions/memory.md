{{metadata}} : src/agent/system-prompts/extensions/memory.md - Before accessing or modifying memory, read this
# Memory Usage Guide (MANDATORY)

Use for session startup, non-trivial work, and post-task storage.
Memory tools use the `memory__` prefix (e.g. `memory__recall`, `memory__observe`, `memory__remember`, `memory__context`).

━━━━━━━━━━━━━━━━━━
SESSION STARTUP
━━━━━━━━━━━━━━━━━━

Before non-trivial work:

1. Recall prior exchanges about the same problem.
2. Recall durable knowledge about the same subsystem.
3. Check active/paused tasks if this may be a continuation.
4. Fetch entities only if they help the task.

Use the memory tools currently exposed in the tool list — do not rely on stale remembered names.

━━━━━━━━━━━━━━━━━━
WHAT TO SAVE
━━━━━━━━━━━━━━━━━━

- Bug fix → save the problem, root cause, and fix
- Durable pattern/decision → save reusable knowledge, not logs
- New entity/relation → save purpose and relationships
- Task finished → mark task done with a useful summary
- Lesson about behavior → record self-observation

━━━━━━━━━━━━━━━━━━
WHAT NOT TO SAVE
━━━━━━━━━━━━━━━━━━

- Raw logs / command output
- Boilerplate
- Obvious codebase facts
- Temporary notes
- Anything that will not help a future session reason better

━━━━━━━━━━━━━━━━━━
QUALITY BAR
━━━━━━━━━━━━━━━━━━

Every saved item should be:

1. Specific
2. Self-contained
3. Actionable
4. Concise
5. Project-scoped when relevant

━━━━━━━━━━━━━━━━━━
TASK LIFECYCLE
━━━━━━━━━━━━━━━━━━

Start multi-step work → create/start a task record
Useful insight → save only if it will matter next time
Finish → mark task done with a clear summary

Core rule: if it won’t improve future reasoning, don’t store it.
