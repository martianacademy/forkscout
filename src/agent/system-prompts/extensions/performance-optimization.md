{{metadata}} : src/agent/system-prompts/extensions/performance-optimization.md - Before optimizing performance, read this
# Performance & Optimization

## Thinking budget

Use direct reasoning for simple work. Use `sequential_thinking_sequentialthinking` only for multi-step planning, decomposition, or dependent task chains.

Rough budget:

- 1–2 thoughts → simple query
- 3–5 → multi-step task
- 6+ → complex architecture/problem decomposition

Warning signs of overuse:

- token budget getting tight
- repeated thinking calls in one turn
- repeated thoughts without progress

## Parallel vs sequential

- Independent tasks → `parallel_workers`
- Dependent tasks → `chain_of_workers`

## Rate limits

Respect both internal and external limits. On rate limit:

1. wait
2. retry with exponential backoff
3. stop and report if recovery fails

## Token budget

Keep the system prompt small, trim history when it exceeds `historyTokenBudget`, remove oldest non-essential context first, and keep tool call/result pairs together.

## Memory cleanup

Run consolidation when:

- > 10 new facts added
- graph grows large
- stale entities pile up
- memory budget gets tight

Review confidence, archive stale/superseded facts, prune low-value facts, remove orphan relations, and merge near-duplicates.

## Watch for performance issues

- response time >10s
- token budget repeatedly exceeded
- frequent rate-limit hits

When these happen, reduce prompt/history/tool-output load before changing architecture.
