/**
 * Planning Agent — enriched pre-flight that builds full context before the main loop.
 *
 * Replaces the old blind preflight with a context-aware planner:
 *   1. Gathers recent chat history from memory
 *   2. Searches knowledge graph + past exchanges for relevant context
 *   3. Runs generateObject() with all context → structured plan
 *   4. Pre-fetches any memory the planner recommends
 *
 * The main agent receives:
 *   - Structured tasks (not just verb phrases)
 *   - Specific tool recommendations (not just categories)
 *   - Pre-fetched memory context (saves tool calls during execution)
 *   - Immediate acknowledgment (streamed to user)
 *
 * Cost: ~300–800 tokens on fast/balanced tier.
 *
 * @module llm/planner
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import type { ModelRouter, ModelTier } from './router';
import type { MemoryManager } from '../memory';
import { getConfig } from '../config';

// ── Available tool names (for recommendation) ──────────

/** All known tool names — planner picks from these for recommendations. */
const AVAILABLE_TOOLS = [
    // Memory
    'forkscout-mem_search_knowledge', 'forkscout-mem_search_entities', 'forkscout-mem_search_exchanges',
    'forkscout-mem_add_entity', 'forkscout-mem_add_exchange', 'forkscout-mem_save_knowledge',
    'forkscout-mem_add_relation', 'forkscout-mem_start_task', 'forkscout-mem_complete_task',
    'forkscout-mem_self_observe',
    // Filesystem
    'read_file', 'write_file', 'append_file', 'delete_file', 'list_directory',
    // Web
    'web_search', 'browse_web', 'http_request',
    // Shell
    'run_command',
    // Agents
    'spawn_agents',
    // Planning
    'manage_todos', 'think',
    // Other
    'get_current_date', 'get_budget',
] as const;

// ── Schema ─────────────────────────────────────────────

const TaskSchema = z.object({
    title: z.string().describe('Action item (imperative verb phrase, e.g. "Search for error in logs")'),
    tool: z.string().optional().describe('Primary tool to use for this step (exact tool name)'),
    verification: z.string().optional().describe('How to verify this step succeeded'),
});

export const PlannerSchema = z.object({
    intent: z.string().describe('One-sentence summary of what the user wants'),
    effort: z.enum(['quick', 'moderate', 'deep']).describe(
        'quick = simple question, greeting, or factual recall. ' +
        'moderate = needs a few tool calls (search, file read, single command). ' +
        'deep = multi-step research, debugging, coding across files, or spawning sub-agents.',
    ),
    needsTools: z.boolean().describe('Whether answering this requires calling any tools'),
    tasks: z.array(TaskSchema).max(8).describe(
        'Structured ordered steps to accomplish the task. Empty array if effort is quick.',
    ),
    recommendedTools: z.array(z.string()).describe(
        'Exact tool names the main agent should prioritize (from the available tools list)',
    ),
    memoryQueries: z.array(z.string()).max(3).describe(
        'Additional queries to run against memory before the main loop starts. ' +
        'Empty if the provided context is sufficient or effort is quick.',
    ),
    acknowledgment: z.string().describe(
        'A brief 1-2 sentence immediate response to let the user know you understood. ' +
        'For quick tasks: this IS the full answer (e.g. "Hello!", "12", "Yes, that\'s correct."). ' +
        'For moderate/deep tasks: a short acknowledgment of what you\'re about to do.',
    ),
});

export type PlannerResult = z.infer<typeof PlannerSchema>;
export type PlannerTask = z.infer<typeof TaskSchema>;

// ── Defaults (when planner fails or is skipped) ────────

const FALLBACK: PlannerResult = {
    intent: '',
    effort: 'moderate',
    needsTools: true,
    tasks: [],
    recommendedTools: [],
    memoryQueries: [],
    acknowledgment: '',
};

// ── Effort → Tier mapping ──────────────────────────────

const EFFORT_TO_TIER: Record<PlannerResult['effort'], ModelTier> = {
    quick: 'fast',
    moderate: 'balanced',
    deep: 'powerful',
};

// ── System prompt for the planner ──────────────────────

const PLANNER_SYSTEM = `You are a planning agent that analyzes user requests with full context.

You receive:
- The user's current message
- Recent conversation history (for continuity)
- Relevant memory/knowledge from past sessions
- Active tasks in progress

Your job: produce a structured plan for the main agent to execute.

Rules:
- "quick" = greetings, simple factual questions, acknowledgments, status checks, follow-ups that need no tools
- "moderate" = needs a few tool calls — web search, file reads, single commands
- "deep" = multi-step work — debugging, writing code across files, research with multiple sources, spawning parallel agents
- Be conservative: if unsure between moderate and deep, pick moderate
- tasks: 1–8 structured items with tool hints and verification criteria. Empty for quick.
- recommendedTools: pick EXACT tool names from the available list. Only include tools actually needed.
- memoryQueries: queries to pre-fetch from memory ONLY if the provided context is missing something. Usually empty — the context provided is often sufficient.
- acknowledgment: For quick tasks, write the FULL answer directly (use the conversation history and memory to give a contextual answer). For moderate/deep, write a brief acknowledgment.
- Use conversation history to understand context — "yes", "do it", "continue" should be interpreted in context of the last exchange.
- Use memory/knowledge to avoid re-discovering things the agent already knows.

Available tools:
${AVAILABLE_TOOLS.join(', ')}`;

// ── Context gathering (parallel) ───────────────────────

interface PlannerContext {
    recentChat: string;
    memoryHits: string;
    activeTodos: string;
}

/**
 * Gather context from memory and state for the planner.
 * Runs memory queries in parallel for speed.
 */
async function gatherContext(
    userMessage: string,
    memory: MemoryManager,
): Promise<PlannerContext> {
    const cfg = getConfig().agent;
    const chatLimit = cfg.plannerChatHistoryLimit ?? 5;

    // Run in parallel: recent chat + knowledge search + entity search
    const [recentHistory, knowledgeHits, entityHits] = await Promise.allSettled([
        // Last N exchanges
        (async () => {
            const history = memory.getRecentHistory(chatLimit * 2); // pairs
            if (history.length === 0) return '';
            return history.map(m => `${m.role}: ${m.content}`).join('\n');
        })(),
        // Knowledge search
        (async () => {
            const results = await memory.searchKnowledge(userMessage, 5);
            if (results.length === 0) return '';
            return results.map(r => `[${r.source}] ${r.content}`).join('\n');
        })(),
        // Entity search
        (async () => {
            const entities = await memory.searchEntities(userMessage, 3);
            if (entities.length === 0) return '';
            return entities.map(e =>
                `${e.name} (${e.type}): ${e.facts.map(f => f.content).join('; ')}`,
            ).join('\n');
        })(),
    ]);

    const chatStr = recentHistory.status === 'fulfilled' ? recentHistory.value : '';
    const knowledgeStr = knowledgeHits.status === 'fulfilled' ? knowledgeHits.value : '';
    const entityStr = entityHits.status === 'fulfilled' ? entityHits.value : '';

    let memoryHits = '';
    if (knowledgeStr) memoryHits += '[Relevant Knowledge]\n' + knowledgeStr;
    if (entityStr) memoryHits += (memoryHits ? '\n\n' : '') + '[Relevant Entities]\n' + entityStr;

    // Active todos
    let activeTodos = '';
    try {
        const { getCurrentTodos } = await import('../tools/todo-tool');
        const todos = getCurrentTodos();
        if (todos.length > 0) {
            const lines = todos.map(t => {
                const icon = t.status === 'completed' ? '✅' : t.status === 'in-progress' ? '🔄' : '⬜';
                return `${icon} ${t.id}. ${t.title}`;
            });
            activeTodos = lines.join('\n');
        }
    } catch { /* no todos */ }

    return { recentChat: chatStr, memoryHits, activeTodos };
}

// ── Build the planner prompt ───────────────────────────

function buildPlannerPrompt(userMessage: string, context: PlannerContext): string {
    const parts: string[] = [`[User Message]\n${userMessage}`];

    if (context.recentChat) {
        parts.push(`[Recent Conversation]\n${context.recentChat}`);
    }
    if (context.memoryHits) {
        parts.push(context.memoryHits);
    }
    if (context.activeTodos) {
        parts.push(`[Active Tasks]\n${context.activeTodos}`);
    }

    return parts.join('\n\n');
}

// ── Pre-fetch additional memory ────────────────────────

export interface PreFetchedMemory {
    /** Knowledge/entity results from planner-requested queries */
    additionalContext: string;
    /** The context gathered during planning (chat history, initial memory) */
    plannerContext: PlannerContext;
}

/**
 * Execute memory queries the planner requested, return combined results.
 */
async function preFetchMemory(
    queries: string[],
    memory: MemoryManager,
): Promise<string> {
    if (queries.length === 0) return '';

    const results = await Promise.allSettled(
        queries.map(async (q) => {
            const hits = await memory.searchKnowledge(q, 3);
            if (hits.length === 0) return '';
            return `[Memory: "${q}"]\n` + hits.map(r => `• ${r.content}`).join('\n');
        }),
    );

    return results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled' && !!r.value)
        .map(r => r.value)
        .join('\n\n');
}

// ── Main Function ──────────────────────────────────────

/**
 * Run the planning agent — context-aware structured analysis before the main loop.
 *
 * Gathers memory + chat history, runs generateObject() with full context,
 * then pre-fetches any additional memory the planner requested.
 *
 * Falls back gracefully on any error — never blocks the main request.
 */
export async function runPlanner(
    userMessage: string,
    router: ModelRouter,
    memory: MemoryManager,
): Promise<{ plan: PlannerResult; preFetched: PreFetchedMemory }> {
    const cfg = getConfig().agent;

    try {
        // 1. Gather context (parallel memory + history reads)
        const context = await gatherContext(userMessage, memory);

        // 2. Build the enriched prompt
        const prompt = buildPlannerPrompt(userMessage, context);

        // 3. Choose tier: fast for quick-looking messages, balanced for deep
        //    Use a simple heuristic — short messages likely quick
        const plannerTier: ModelTier = userMessage.length < 30 && !context.activeTodos ? 'fast' : 'fast';
        const { model } = router.getModelByTier(plannerTier);

        // 4. Generate structured plan
        const { object } = await generateObject({
            model,
            schema: PlannerSchema,
            system: PLANNER_SYSTEM,
            prompt,
            temperature: 0,
            maxRetries: cfg.flightMaxRetries,
        });

        // Enforce limits
        if (object.tasks.length > (cfg.plannerMaxTasks ?? 8)) {
            object.tasks = object.tasks.slice(0, cfg.plannerMaxTasks ?? 8);
        }

        console.log(
            `[Planner]: effort=${object.effort} tasks=${object.tasks.length} ` +
            `tools=[${object.recommendedTools.join(', ')}] ` +
            `memoryQueries=${object.memoryQueries.length} ` +
            `context=[chat:${context.recentChat ? 'yes' : 'no'} memory:${context.memoryHits ? 'yes' : 'no'} todos:${context.activeTodos ? 'yes' : 'no'}]`,
        );

        // 5. Pre-fetch any additional memory the planner requested
        const additionalContext = await preFetchMemory(object.memoryQueries, memory);

        return {
            plan: object,
            preFetched: { additionalContext, plannerContext: context },
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[Planner]: Failed — using fallback. ${msg.slice(0, 150)}`);
        return {
            plan: { ...FALLBACK, intent: userMessage.slice(0, 100) },
            preFetched: { additionalContext: '', plannerContext: { recentChat: '', memoryHits: '', activeTodos: '' } },
        };
    }
}

// ── Helpers (exported for consumers) ───────────────────

/**
 * Map a planner effort level to a model tier.
 */
export function effortToTier(effort: PlannerResult['effort']): ModelTier {
    return EFFORT_TO_TIER[effort];
}

/**
 * Format the planner result as a system prompt injection for the main agent.
 */
export function formatPlanForPrompt(plan: PlannerResult, preFetched: PreFetchedMemory): string {
    const sections: string[] = [];

    // Intent + effort
    sections.push(`Intent: ${plan.intent}`);
    sections.push(`Effort: ${plan.effort}`);

    // Structured tasks
    if (plan.tasks.length > 0) {
        const taskLines = plan.tasks.map((t, i) => {
            let line = `${i + 1}. ${t.title}`;
            if (t.tool) line += ` → use \`${t.tool}\``;
            if (t.verification) line += ` [verify: ${t.verification}]`;
            return line;
        });
        sections.push(`Tasks:\n${taskLines.join('\n')}`);
    }

    // Recommended tools
    if (plan.recommendedTools.length > 0) {
        sections.push(`Recommended tools: ${plan.recommendedTools.join(', ')}`);
    }

    // Pre-fetched memory from planner queries
    if (preFetched.additionalContext) {
        sections.push(`[Pre-fetched Context]\n${preFetched.additionalContext}`);
    }

    if (sections.length === 0) return '';
    return '\n\n[Planning Agent Analysis]\n' + sections.join('\n');
}
