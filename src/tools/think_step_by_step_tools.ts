// src/tools/think.ts — Silent reasoning step
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = true;

export const think_step_by_step_tools = tool({
    description:
        "Reason through a problem before acting. Call this FIRST for any complex, multi-step, or ambiguous task. " +
        "After this tool returns you MUST immediately follow up — either call the next required tool or write your response. " +
        "Never stop after thinking. This tool exists precisely to guarantee a follow-up action.",
    inputSchema: z.object({
        thought: z.string().describe("Your internal step-by-step reasoning and plan of action"),
    }),
    execute: async (input) => {
        // Returns the thought as context so the model sees its own plan and acts on it.
        return { thought: input.thought, instruction: "Now act on the plan above — call the next tool or write your response." };
    },
});