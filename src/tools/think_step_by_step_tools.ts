// src/tools/think_step_by_step_tools.ts
// Structured chain-of-thought scratchpad. Call this BEFORE complex tool sequences
// to reason out a plan. The output stays in context and guides subsequent steps.
// Does NOT call the LLM — it's just a structured way to surface reasoning.

import { tool } from "ai";
import { z } from "zod";

export const think_step_by_step = tool({
    description:
        "Think through a problem step-by-step before acting. " +
        "Use this when a task has multiple steps, unknowns, or risks. " +
        "Write out your plan, constraints, and approach. This helps avoid mistakes and loops. " +
        "The thinking is recorded in context so you don't repeat yourself.",
    inputSchema: z.object({
        problem: z.string().describe("What problem or task you're solving"),
        steps: z.array(z.string()).describe("Your planned steps in order"),
        risks: z.array(z.string()).optional().describe("Potential issues or things that might go wrong"),
        decision: z.string().describe("What you've decided to do first"),
    }),
    execute: async (input) => {
        return {
            success: true,
            recorded: true,
            problem: input.problem,
            plan: input.steps,
            risks: input.risks ?? [],
            next_action: input.decision,
        };
    },
});
