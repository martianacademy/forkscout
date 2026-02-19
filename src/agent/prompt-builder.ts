import type { ChatContext, AgentConfig } from './types';
import type { MemoryManager } from '../memory';
import type { SurvivalMonitor } from '../survival';
import type { CronAlert } from '../scheduler';
import type { ModelRouter } from '../llm/router';
import { getConfig } from '../config';
import { getDefaultSystemPrompt, getPublicSystemPrompt } from './system-prompts';
import { getCurrentTodos } from '../tools/todo-tool';

/**
 * Mutable cache object — owned by the Agent instance, passed by reference.
 * Uses nullish-coalescing assignment (??=) so prompts are computed once.
 */
export interface PromptCache {
    defaultPrompt: string | null;
    publicPrompt: string | null;
}

/**
 * Build the system prompt, enriched with memory context for the given user query.
 * Injects access control rules based on whether the user is admin.
 */
export async function buildSystemPrompt(
    config: AgentConfig,
    memory: MemoryManager,
    survival: SurvivalMonitor,
    urgentAlerts: CronAlert[],
    cache: PromptCache,
    router: ModelRouter,
    userQuery: string,
    ctx?: ChatContext,
): Promise<string> {
    const isAdmin = ctx?.isAdmin ?? false;
    const base = isAdmin
        ? config.systemPrompt || (cache.defaultPrompt ??= getDefaultSystemPrompt())
        : (cache.publicPrompt ??= getPublicSystemPrompt());

    // Channel/sender awareness
    let channelSection = '';
    if (ctx) {
        const who = ctx.sender || 'unknown user';
        const via = ctx.channel || 'unknown';
        channelSection = `\n\n[Current Session]\nSpeaking with: ${who} | Channel: ${via} | Role: ${isAdmin ? 'ADMIN' : 'guest'}`;
        if (ctx.metadata && Object.keys(ctx.metadata).length > 0) {
            channelSection += ` | ${Object.entries(ctx.metadata)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')}`;
        }
    }

    // Surface pending urgent alerts — keep them so they persist across turns
    // until the agent addresses them. Only drain after a configurable number of
    // exposures so the agent doesn't lose track of unresolved issues.
    let alertSection = '';
    if (urgentAlerts.length > 0) {
        alertSection =
            '\n\n[URGENT ALERTS — you MUST investigate and resolve these. Do NOT ignore them.]\n' +
            urgentAlerts.map((a) => `🚨 "${a.jobName}" at ${a.timestamp}: ${a.output.slice(0, 1000)}`).join('\n') +
            '\n\nFor each alert: 1) Read the error, 2) Run the command manually, 3) Fix the root cause, 4) Verify the fix works.';

        // Mark alerts as "shown" — drain after 3 exposures (3 chat turns)
        for (const a of urgentAlerts) {
            (a as any)._exposures = ((a as any)._exposures || 0) + 1;
        }
        // Remove alerts that have been shown 3+ times (agent had enough chances)
        const stale = urgentAlerts.filter((a) => ((a as any)._exposures || 0) >= 3);
        if (stale.length > 0) {
            for (const s of stale) {
                const idx = urgentAlerts.indexOf(s);
                if (idx >= 0) urgentAlerts.splice(idx, 1);
            }
        }
    }

    // Survival alerts (battery, disk, integrity, etc.)
    const survivalAlerts = survival.formatAlerts();
    alertSection += survivalAlerts;

    // Memory context — only injected for admin users (guests must not see private data)
    let memorySection = '';
    let selfSection = '';
    if (isAdmin) {
        try {
            // Self-identity — who am I? (async fetch from MCP, cached)
            const selfCtx = await memory.getSelfContextAsync();
            if (selfCtx) {
                selfSection = '\n\n[LEARNED BEHAVIORS — follow these rigorously, they come from your own experience and owner directives]\n' + selfCtx;
            }

            const { recentHistory, relevantMemories, graphContext, skillContext, stats } =
                await memory.buildContext(userQuery);
            if (stats.retrievedCount > 0 || stats.graphEntities > 0 || stats.skillCount > 0) {
                console.log(
                    `[Memory]: ${stats.recentCount} recent + ${stats.retrievedCount} vector + ${stats.graphEntities} graph entities + ${stats.skillCount} skills | situation: [${stats.situation.primary.join(', ')}] ${stats.situation.goal}`,
                );
            }
            if (recentHistory) memorySection += '\n\n[Recent Conversation]\n' + recentHistory;
            if (graphContext) memorySection += graphContext;
            if (skillContext) memorySection += '\n\n[Known Skills]\n' + skillContext;
            if (relevantMemories) memorySection += relevantMemories;
        } catch {
            /* memory unavailable — continue without it */
        }
    }

    // Active todo list — inject so the agent remembers its plan across turns
    let todoSection = '';
    const todos = getCurrentTodos();
    if (todos.length > 0) {
        const completed = todos.filter(t => t.status === 'completed').length;
        const lines = todos.map(t => {
            const icon = t.status === 'completed' ? '✅' : t.status === 'in-progress' ? '🔄' : '⬜';
            return `${icon} ${t.id}. ${t.title}${t.notes ? ` — ${t.notes}` : ''}`;
        });
        todoSection = `\n\n[Active Todo List — ${completed}/${todos.length} completed]\n` + lines.join('\n');
    }

    // Runtime config — so the agent knows its own model, provider, and capabilities
    let configSection = '';
    if (isAdmin) {
        try {
            const cfg = getConfig();
            const status = router.getStatus();
            const budgetStatus = status.budget;
            const lines = [
                `\n\n[Runtime Config — YOUR current setup]`,
                `Provider: ${cfg.provider}`,
                `Model tiers:`,
                `  fast: ${status.tiers.fast.modelId} (${status.tiers.fast.provider})`,
                `  balanced: ${status.tiers.balanced.modelId} (${status.tiers.balanced.provider})`,
                `  powerful: ${status.tiers.powerful.modelId} (${status.tiers.powerful.provider})`,
                `You are currently running on the balanced tier model unless complexity escalated you.`,
                `Temperature: ${cfg.temperature ?? 'default'}`,
                `Budget: $${budgetStatus.todayUSD.toFixed(2)}/$${budgetStatus.dailyLimitUSD}/day, $${budgetStatus.monthUSD.toFixed(2)}/$${budgetStatus.monthlyLimitUSD}/month (${budgetStatus.dailyPct.toFixed(0)}% daily used)`,
            ];
            if (budgetStatus.cappedTier) {
                lines.push(`⚠️ Budget pressure — capped to ${budgetStatus.cappedTier} tier`);
            }
            configSection = lines.join('\n');
        } catch { /* config unavailable — skip */ }
    }

    return base + channelSection + alertSection + configSection + selfSection + todoSection + memorySection;
}
