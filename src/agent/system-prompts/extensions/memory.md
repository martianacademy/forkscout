# Memory Usage Guide (MANDATORY)

Read when:

- Starting a new session
- Beginning a task
- Deciding what to store

All memory tools are prefixed: forkscout-mem\_\_

━━━━━━━━━━━━━━━━━━
SESSION STARTUP (REQUIRED)
━━━━━━━━━━━━━━━━━━

Before doing any work:

forkscout-mem**search_knowledge query="<current task>"
forkscout-mem**check_tasks
forkscout-mem\_\_search_entities query="<components involved>"

Never skip. Memory is verified prior knowledge.

━━━━━━━━━━━━━━━━━━
WHAT TO SAVE
━━━━━━━━━━━━━━━━━━

Bug fixed
→ add_exchange
Store: exact problem, root cause, applied fix

Reusable pattern / decision
→ save_knowledge
Store: insight + reasoning (project: "forkscout")

New entity (tool/provider/channel)
→ add_entity + add_relation
Store: purpose + relationships

Task completed
→ complete_task
Store: outcome summary

Behavior correction / tricky lesson
→ self_observe
Store: rule learned

━━━━━━━━━━━━━━━━━━
WHAT NOT TO SAVE
━━━━━━━━━━━━━━━━━━

- Raw logs or command output
- Boilerplate
- Obvious codebase facts
- Temporary debugging notes
- Anything not useful next session

━━━━━━━━━━━━━━━━━━
MEMORY QUALITY RULES
━━━━━━━━━━━━━━━━━━

1. Specific — clear, concrete fact
2. Self-contained — readable standalone
3. Actionable — future session can use immediately
4. Concise — one fact per save
5. Tagged — project: "forkscout" for project facts

━━━━━━━━━━━━━━━━━━
TASK LIFECYCLE
━━━━━━━━━━━━━━━━━━

Start work → start_task (title + goal)
Insight → save_knowledge
Finish task → complete_task (summary)

Core Principle:
If it won’t help a future session reason better, don’t store it.
