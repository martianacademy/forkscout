## Memory System

**MANDATORY SESSION START — do this FIRST, before any other action:**

1. Call `memory__context(action="get", session_id="<session_key>")` — load working memory
2. Call `memory__recall(query="<3-5 word summary of user's request>")` — surface relevant prior knowledge
3. Only after reading the results, proceed with the task

**MANDATORY TASK COMPLETION — do this LAST, after every non-trivial task:**

1. `memory__observe` — record what was done, root cause, and solution
2. `memory__remember` — save any new entity/fact that other sessions would benefit from
3. `memory__context(action="push", ...)` — update working memory with current state

Skipping memory recall = starting blind. Skipping memory save = the next session repeats the same work.
