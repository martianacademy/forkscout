/**
 * Usage analytics & model tier tools — check spending, change models.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { ModelRouter, ModelTier } from '../llm/router';
import type { ToolDeps } from './deps';

/** Auto-discovered by auto-loader — called with ToolDeps at startup. */
export function register(deps: ToolDeps) {
    return createUsageTools(deps.router);
}

/**
 * Create tools for usage monitoring and model tier management.
 * These let the agent (and admin) check spending analytics and control model selection.
 */
export function createUsageTools(router: ModelRouter) {
    return {
        check_usage: tool({
            description: `Check current LLM spending and usage analytics.
Shows today's spending, monthly total, per-model breakdown with token counts.
Use this when asked about costs, spending, usage, or model usage.
This is analytics only — informational, no limits or enforcement.`,
            inputSchema: z.object({}),
            execute: async () => {
                const status = router.getStatus();
                const usage = status.usage;

                let report = `📊 **LLM Usage Analytics**\n\n`;
                report += `**Today**: $${usage.todayUSD.toFixed(4)}\n`;
                report += `**This Month**: $${usage.monthUSD.toFixed(4)}\n\n`;

                report += `**Model Tiers**:\n`;
                for (const [tier, info] of Object.entries(status.tiers)) {
                    report += `- ${tier}: \`${info.modelId}\` ($${info.inputPricePer1M}/$${info.outputPricePer1M} per 1M tokens)\n`;
                }

                const models = Object.entries(usage.todayByModel);
                if (models.length > 0) {
                    report += `\n**Today's Usage by Model**:\n`;
                    for (const [modelId, u] of models) {
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
    };
}
