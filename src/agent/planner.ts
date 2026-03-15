// src/agent/planner.ts — Structured pre-run task planner using output: "object"
import { generateText } from "ai";
import { z } from "zod";
import { log } from "@/logs/logger.ts";
import type { LanguageModel } from "ai";

const logger = log("planner");

export const TaskPlanSchema = z.object({
    goal: z.string().describe("What the user wants to achieve"),
    approach: z.string().describe("High-level approach to solve this"),
    steps: z.array(z.string()).describe("Ordered execution steps"),
    tools_likely_needed: z.array(z.string()).describe("Tools probably needed"),
    complexity: z.enum(["simple", "medium", "complex"]),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;

/**
 * Runs a structured planning step before the main agent run.
 * Uses output:"object" + Zod schema. Returns null if provider doesn't support it.
 */
export async function planTask(
    model: LanguageModel,
    userMessage: string,
    systemContext?: string,
): Promise<TaskPlan | null> {
    if (userMessage.trim().length < 20) return null; // skip trivial messages

    // Explicitly check for models/providers known to fail rigorous structured output
    if ((model as any).provider?.includes("lmstudio") || (model as any).provider?.includes("ollama")) {
        logger.info(`[planner] skipping structured planning (unsupported on ${(model as any).provider})`);
        return null;
    }

    try {
        const result = await generateText({
            model,
            output: "object",
            schema: TaskPlanSchema,
            maxTokens: 512,
            messages: [
                {
                    role: "system",
                    content: `You are a task planner. Analyze the user's request and produce a structured plan.${systemContext ? `\nContext: ${systemContext}` : ""}`,
                },
                { role: "user", content: userMessage },
            ],
        } as any);

        const plan = (result as any).object as TaskPlan;
        if (!plan?.goal) return null;
        logger.info(`[planner] complexity=${plan.complexity} steps=${plan.steps.length} tools=${plan.tools_likely_needed.join(", ") || "none"}`);
        return plan;
    } catch (err) {
        // Provider doesn't support structured output — silently skip
        logger.warn(`[planner] structured output not supported, skipping: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}

/** Formats a TaskPlan into a system message string to inject as context */
export function formatPlanAsContext(plan: TaskPlan): string {
    return [
        `[PRE-PLAN] Complexity: ${plan.complexity}`,
        `Goal: ${plan.goal}`,
        `Approach: ${plan.approach}`,
        `Steps: ${plan.steps.map((s, i) => `${i + 1}. ${s}`).join(" | ")}`,
        plan.tools_likely_needed.length > 0
            ? `Expected tools: ${plan.tools_likely_needed.join(", ")}`
            : "",
    ].filter(Boolean).join("\n");
}
