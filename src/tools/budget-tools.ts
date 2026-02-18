/**
 * Budget & model tier tools — check spending, change models, update limits.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { ModelRouter, ModelTier } from '../llm/router';

/**
 * Create tools for budget monitoring and model tier management.
 * These let the agent (and admin) check spending and control model selection.
 */
export function createBudgetTools(router: ModelRouter) {
    return {
        check_budget: tool({
            description: `Check current LLM spending and budget status.
Shows today's spending, monthly total, per-model breakdown, budget limits,
and whether any tier downgrades are in effect due to budget constraints.
Use this when asked about costs, spending, budget, or model usage.`,
            inputSchema: z.object({}),
            execute: async () => {
                const status = router.getStatus();
                const budget = status.budget;

                let report = `💰 **LLM Budget Status**\n\n`;
                report += `**Today**: $${budget.todayUSD.toFixed(4)} / $${budget.dailyLimitUSD.toFixed(2)} (${budget.dailyPct.toFixed(1)}%)\n`;
                report += `**This Month**: $${budget.monthUSD.toFixed(4)} / $${budget.monthlyLimitUSD.toFixed(2)} (${budget.monthlyPct.toFixed(1)}%)\n\n`;

                if (budget.cappedTier) {
                    report += `⚠️ **Budget cap active** — limited to \`${budget.cappedTier}\` tier\n\n`;
                }

                report += `**Model Tiers**:\n`;
                for (const [tier, info] of Object.entries(status.tiers)) {
                    report += `- ${tier}: \`${info.modelId}\` ($${info.inputPricePer1M}/$${info.outputPricePer1M} per 1M tokens)\n`;
                }

                const models = Object.entries(budget.todayByModel);
                if (models.length > 0) {
                    report += `\n**Today's Usage by Model**:\n`;
                    for (const [modelId, usage] of models) {
                        const u = usage as { cost: number; calls: number; inputTokens: number; outputTokens: number };
                        report += `- \`${modelId}\`: $${u.cost.toFixed(4)} (${u.calls} calls, ${u.inputTokens} in / ${u.outputTokens} out)\n`;
                    }
                }

                return report;
            },
        }),

        set_model_tier: tool({
            description: `Change the model used for a specific tier (fast/balanced/powerful).
Example: set the fast tier to "google/gemini-2.0-flash-lite-001" for cheaper background tasks.
Only the admin should use this. Changes take effect immediately.`,
            inputSchema: z.object({
                tier: z.enum(['fast', 'balanced', 'powerful']).describe('Which tier to change'),
                modelId: z.string().describe('The model ID to use (e.g. "google/gemini-2.0-flash-001", "x-ai/grok-4.1-fast")'),
            }),
            execute: async ({ tier, modelId }) => {
                router.setTierModel(tier as ModelTier, modelId);
                return `✅ ${tier} tier now uses \`${modelId}\``;
            },
        }),

        set_budget_limit: tool({
            description: `Update daily or monthly budget limits. Use this to increase or decrease spending caps.
Only the admin should use this.`,
            inputSchema: z.object({
                dailyUSD: z.number().optional().describe('New daily limit in USD (e.g. 10.0)'),
                monthlyUSD: z.number().optional().describe('New monthly limit in USD (e.g. 100.0)'),
            }),
            execute: async ({ dailyUSD, monthlyUSD }) => {
                const patch: Record<string, number> = {};
                if (dailyUSD !== undefined) patch.dailyUSD = dailyUSD;
                if (monthlyUSD !== undefined) patch.monthlyUSD = monthlyUSD;
                const updated = router.getBudget().setLimits(patch);
                return `✅ Budget limits updated — daily: $${updated.dailyUSD.toFixed(2)}, monthly: $${updated.monthlyUSD.toFixed(2)}`;
            },
        }),
    };
}
