// src/tools/think.ts — Silent reasoning step
import { tool } from "ai";
import { z } from "zod";

export const thinkTool = tool({
    description: "Think through a problem step by step before responding. Use this to reason carefully before taking action.",
    inputSchema: z.object({
        thought: z.string().describe("Your internal reasoning or analysis"),
    }),
    execute: async (input) => {
        // Silent tool — just returns the thought back as context
        return { thought: input.thought };
    },
});