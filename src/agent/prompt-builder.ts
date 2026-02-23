import type { ChatContext, AgentConfig } from './types';
import type { MemoryManager } from '../memory';
import type { SurvivalMonitor } from '../survival';
import type { ModelRouter } from '../llm/router';
import { getConfig } from '../config';
import { getDefaultSystemPrompt, getPublicSystemPrompt } from './system-prompts';
import { getCurrentTodos } from '../tools/todo-tool';
import { requestTracker } from '../request-tracker';
import * as personalities from './personalities';

// ── Trivial message detection ──────────────────────────

/**
 * Short greetings, pleasantries, and single-word messages that don't benefit
 * from full memory injection.  Saves ~1–2K tokens on throwaway messages.
 */
const TRIVIAL_PATTERNS = /^\s*(h(i|ello|ey|ola|owdy)|yo+|sup|gm|gn|thanks?|thx|ok(ay)?|yes|no|bye|ciao|cheers|good\s*(morning|evening|night|afternoon)|what'?s?\s*up|how\s*are\s*you|test(ing)?|ping)\s*[?!.]*\s*$/i;

/**
 * Mutable cache object — owned by the Agent instance, passed by reference.
 * Uses nullish-coalescing assignment (??=) so prompts are computed once.
 */
export interface PromptCache {
    defaultPrompt: string | null;
    publicPrompt: string | null;
    publicPromptToolHash: string | null;
}

/**
 * Build the system prompt, enriched with memory context for the given user query.
 * Injects access control rules based on whether the user is admin.
 *
 * Memory fetching is always full for admin users.
 */
export async function buildSystemPrompt(
    config: AgentConfig,
    memory: MemoryManager,
    survival: SurvivalMonitor,
    cache: PromptCache,
    router: ModelRouter,
    userQuery: string,
    ctx?: ChatContext,
    guestTools?: Record<string, any>,
): Promise<string> {
    const isAdmin = ctx?.isAdmin ?? false;

    // Resolve the base prompt — admin uses full prompt, guest gets tool-aware public prompt
    let base: string;
    if (isAdmin) {
        base = config.systemPrompt || (cache.defaultPrompt ??= getDefaultSystemPrompt());
    } else {
        // Guest tools may change at runtime (MCP add/remove), so rebuild when the set changes
        const guestToolNames = Object.keys(guestTools ?? {}).sort();
        const toolHash = guestToolNames.join(',');
        if (cache.publicPrompt && cache.publicPromptToolHash === toolHash) {
            base = cache.publicPrompt;
        } else {
            base = getPublicSystemPrompt(guestToolNames);
            cache.publicPrompt = base;
            cache.publicPromptToolHash = toolHash;
        }
    }

    // Inject system time at the very top of the prompt for true temporal awareness
    const now = new Date();
    const timeString = now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });
    const timeSection = `[System Time]\n${timeString}\n\n`;

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

    // Cross-channel awareness — admins are trusted friends, they can know what's
    // happening on other channels.  BUT we never inject raw message text — only
    // brief topic hints — so the model paraphrases naturally instead of quoting.
    let crossChannelSection = '';
    if (isAdmin) {
        const activeReqs = requestTracker.list();
        // Show requests on OTHER channels (not the current one)
        const otherReqs = activeReqs.filter(r => {
            if (ctx?.channel && r.channel.startsWith(ctx.channel)) return false;
            return true;
        });

        if (otherReqs.length > 0) {
            const lines = otherReqs.map(r => {
                const elapsed = Math.round(r.elapsedMs / 1000);
                const who = r.sender ? `with ${r.sender}` : '';
                return `  • ${r.channel} ${who} (running for ${elapsed}s)`;
            });
            crossChannelSection = '\n\n[Active Conversations]\n' +
                lines.join('\n') + '\n\n' +
                'RULES for cross-channel transparency:\n' +
                '• When a trusted person (admin/owner) asks what you are doing, describe your other activities ' +
                'naturally in your own words — like a friend would ("I am also helping someone with code analysis").\n' +
                '• NEVER quote, copy, paste, or forward the actual messages from other conversations. ' +
                'Summarize the general topic/intent only — keep other users\' exact words private.\n' +
                '• For non-admin users, NEVER mention other channels or conversations at all.\n' +
                '• You are aware of WHO is talking to you right now. Tailor your response to THIS conversation.';
        }

        // Provide only brief topic hints from other channels — NOT raw message content.
        // This gives the model enough context to describe what it's working on
        // without being able to quote or relay verbatim messages.
        const labeledHistory = memory.getRecentHistoryLabeled(10);
        const crossChannelMsgs = labeledHistory.filter(m =>
            m.channel && ctx?.channel && m.channel !== ctx.channel,
        );
        if (crossChannelMsgs.length > 0) {
            // Extract unique channels and only the most recent user topic per channel
            const topicByChannel = new Map<string, string>();
            for (const m of crossChannelMsgs) {
                if (m.role === 'user' && m.channel) {
                    // Take first 40 chars as a vague topic hint
                    const topic = m.content.slice(0, 40).replace(/\n/g, ' ').trim();
                    topicByChannel.set(m.channel, topic + (m.content.length > 40 ? '…' : ''));
                }
            }
            if (topicByChannel.size > 0) {
                const hints = [...topicByChannel.entries()].map(
                    ([ch, topic]) => `  • ${ch}: topic is roughly "${topic}"`,
                );
                crossChannelSection += '\n[Topic hints — paraphrase these, NEVER relay exact wording]\n' + hints.join('\n');
            }
        }
    }

    // Survival alerts (battery, disk, integrity, etc.)
    let alertSection = '';
    const survivalAlerts = survival.formatAlerts();
    alertSection += survivalAlerts;

    // Memory context — only injected for admin users (guests must not see private data)
    // Skip heavy memory lookups for trivial messages (greetings, yes/no, thanks)
    let memorySection = '';
    let selfSection = '';
    let behavioralRulesSection = '';
    const isTrivial = TRIVIAL_PATTERNS.test(userQuery);
    if (isAdmin && !isTrivial) {
        try {
            // Self-identity — who am I? (async fetch from MCP, filtered by current query)
            const selfCtx = await memory.getSelfContextAsync(userQuery);
            if (selfCtx) {
                selfSection = '\n\n[LEARNED BEHAVIORS — follow these rigorously, they come from your own experience and owner directives]\n' + selfCtx;
            }

            // Per-person behavioral rules — corrections the user has given us (e.g. "don't call me bhai")
            if (ctx?.sender) {
                try {
                    const rules = await memory.getBehavioralRules(ctx.sender);
                    if (rules.length > 0) {
                        behavioralRulesSection = '\n\n[⚠️ BEHAVIORAL RULES for ' + ctx.sender + ' — ALWAYS respect these, they are direct corrections from this person]\n' +
                            rules.map(r => `• ${r.replace(/^\[RULE:\w+\]\s*/, '')}`).join('\n');
                    }
                } catch { /* rules unavailable — continue */ }
            }

            // Full memory injection — vector search, graph, skills (no recentHistory — it duplicates the messages array)
            const { relevantMemories, graphContext, skillContext, stats } =
                await memory.buildContext(userQuery);
            if (stats.retrievedCount > 0 || stats.graphEntities > 0 || stats.skillCount > 0) {
                console.log(
                    `[Memory]: ${stats.recentCount} recent + ${stats.retrievedCount} vector + ${stats.graphEntities} graph entities + ${stats.skillCount} skills | situation: [${stats.situation.primary.join(', ')}] ${stats.situation.goal}`,
                );
            }
            // NOTE: recentHistory is NOT injected here — it duplicates the
            // user/assistant messages already passed via the messages array,
            // wasting tokens on every request.
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
    if (isAdmin && !isTrivial) {
        try {
            const cfg = getConfig();
            const status = router.getStatus();
            const usageStatus = status.usage;
            const lines = [
                `\n\n[Runtime Config — YOUR current setup]`,
                `Provider: ${cfg.provider}`,
                `Model tiers:`,
                `  fast: ${status.tiers.fast.modelId} (${status.tiers.fast.provider})`,
                `  balanced: ${status.tiers.balanced.modelId} (${status.tiers.balanced.provider})`,
                `  powerful: ${status.tiers.powerful.modelId} (${status.tiers.powerful.provider})`,
                `You are running on a model tier selected by pre-flight analysis (quick→fast, moderate→balanced, deep→powerful). May escalate on repeated tool failures.`,
                `Temperature: ${cfg.temperature ?? 'default'}`,
                `Usage today: $${usageStatus.todayUSD.toFixed(2)} | This month: $${usageStatus.monthUSD.toFixed(2)}`,
            ];
            configSection = lines.join('\n');
        } catch { /* config unavailable — skip */ }
    }

    // Available personalities — inject so the agent knows what styles it can adopt
    let personalitySection = '';
    if (isAdmin && !isTrivial) {
        try {
            const available = await personalities.list();
            if (available.length > 0) {
                const lines = available.map(p => {
                    return `  • ${p.name} — ${p.description} (${p.sectionCount} sections)`;
                });
                personalitySection = '\n\n[Available Personalities — adopt these based on context, person, and situation]\n' + lines.join('\n');
            }
        } catch { /* personalities unavailable */ }
    }

    // Tool RAG — when dynamic tool loading is enabled, inject discovery instructions
    let toolDiscoverySection = '';
    if (isAdmin && getConfig().agent.dynamicToolLoading) {
        toolDiscoverySection = `\n\n[TOOL DISCOVERY — IMPORTANT]
You have a small set of core tools loaded. Many more tools are available but NOT visible to you yet.
To find and use additional tools, call \`search_available_tools\` with a description of what you need.
Examples: "send telegram message", "read file", "search the web", "voice synthesis", "memory operations"
Once you search, those tools become available for use in your next step.
ALWAYS search before saying you can't do something — you likely have a tool for it.
Use mode "categories" to see all available tool categories.`;
    }

    return timeSection + base + channelSection + crossChannelSection + alertSection + configSection + selfSection + behavioralRulesSection + personalitySection + toolDiscoverySection + todoSection + memorySection;
}
