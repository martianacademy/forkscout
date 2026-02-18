# Benchmark Evolution Prototype

## Files
- `archetypes.json`: Task templates (math, logic, string).
- `generate_benchmark_tasks.ts`: Generates 1 random task JSON per run.
- Next: `solve_task.ts` (real agent solve), `verify.ts`, `run_benchmark.ts`.

## Usage
```bash
cd custom/benchmark-evolution
npx tsx generate_benchmark_tasks.ts
```

Generates `task_*.json` with prompt to solve.