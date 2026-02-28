# Task Orchestration (MANDATORY)

Use self-sessions to offload work via:

- chain_of_workers (sequential)
- parallel_workers (concurrent)
- list_active_workers
- manage_workers
- telegram_message_tools

━━━━━━━━━━━━━━━━━━
CONFIRMATION GATE (HUMAN CHANNELS ONLY)
━━━━━━━━━━━━━━━━━━

Before calling chain_of_workers or parallel_workers:

If Human channel (Telegram / terminal):

1. Present full execution plan:
   - Chain / Parallel
   - Batch name
   - Workers (task + output location)
   - Aggregator action
   - Estimated time
   - Telegram progress: yes/no
2. Wait for explicit confirmation.
3. Only then call the tool.

If Self-session:
→ Skip confirmation. Execute immediately.

Affirmative triggers:
yes, ok, go, start, karo, haan, confirm, sure

Rejection triggers:
no, stop, cancel, wait, ruk

Spawning workers is irreversible. Always inform humans first.

━━━━━━━━━━━━━━━━━━
TOOL SELECTION
━━━━━━━━━━━━━━━━━━

Sequential dependent steps → chain_of_workers  
Independent concurrent tasks → parallel_workers  
Check running batches → list_active_workers  
Notify user proactively → telegram_message_tools

━━━━━━━━━━━━━━━━━━
CHAIN_OF_WORKERS (SEQUENTIAL)
━━━━━━━━━━━━━━━━━━

Use when steps depend on previous output.

Rules:

- Always create todo/progress file first.
- Never use wait: true.
- Pass chat_id for step notifications if user-facing.

Pattern:

1. Write .agents/tasks/<task>/todo.md
2. chain_of_workers (step 1 reads todo, marks done, calls next)
3. Repeat until all steps marked ✅
4. Final step notifies user.

━━━━━━━━━━━━━━━━━━
PARALLEL_WORKERS (CONCURRENT)
━━━━━━━━━━━━━━━━━━

Use when tasks are independent.

Rules:

- Each worker prompt must be self-contained.
- Each worker writes:
  .agents/tasks/{batch}/{session_key}-result.md
- Each worker flips its line in plan.md from [ ] → [x]
- Aggregator fires automatically when all [x]
- Pass chat_id for live Telegram progress (no LLM cost while waiting)

Pattern:

1. parallel_workers({
   batch_name,
   tasks: [{ session_key, label, prompt }],
   aggregator_prompt,
   chat_id
   })
2. Session ends.
3. Aggregator runs automatically when complete.

━━━━━━━━━━━━━━━━━━
LIST_ACTIVE_WORKERS
━━━━━━━━━━━━━━━━━━

Shows:

- Active batch names
- Worker status
- Progress fraction (e.g. 3/5)
- Monitor status

━━━━━━━━━━━━━━━━━━
TELEGRAM_MESSAGE_TOOLS
━━━━━━━━━━━━━━━━━━

Use for proactive notifications.

- send → specific chat_id
- send_to_owners → broadcast to owners (use when chat_id unknown in self-session)

Messages are saved in chat history automatically.

━━━━━━━━━━━━━━━━━━
MANAGE_WORKERS (RECOVERY)
━━━━━━━━━━━━━━━━━━

Used after restart or for cleanup.

Actions:
resume → restart monitor
cancel → stop monitor, keep task files
delete → full cleanup (state + directory)

Rules:

- Never auto-resume without user instruction.
- If resume fails (plan.md missing) → use delete.

━━━━━━━━━━━━━━━━━━
AGGREGATOR TEMPLATE
━━━━━━━━━━━━━━━━━━

Aggregator must:

1. Read all result files:
   .agents/tasks/{batch}/\*-result.md
2. Compile structured summary.
3. Send summary via telegram_message_tools (send_to_owners).
4. Delete .agents/tasks/{batch}/ using run_shell_commands.

━━━━━━━━━━━━━━━━━━
CORE PRINCIPLE
━━━━━━━━━━━━━━━━━━

Sequential → chain_of_workers  
Independent → parallel_workers  
Human involved → show plan first  
Self-session → execute immediately  
All work must persist progress to disk.
