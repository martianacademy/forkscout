import type { ChatContext, AgentConfig } from './types';
import type { MemoryManager } from '../memory/manager';
import type { SurvivalMonitor } from '../survival';
import type { CronAlert } from '../scheduler';
import { getDefaultSystemPrompt, getPublicSystemPrompt } from './system-prompts';

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
            // Self-identity — who am I?
            const selfCtx = memory.getSelfContext();
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

    return base + channelSection + alertSection + selfSection + memorySection;
}
