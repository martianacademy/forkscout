import { ToolLoopAgent, type ToolSet } from 'ai';
import { z } from 'zod';
import { LLMClient } from '../llm/client';
import { ModelRouter, createRouterFromEnv, type ModelPurpose, type ModelTier } from '../llm/router';
import { MemoryManager } from '../memory';
import { McpConnector } from '../mcp/connector';
import { createTelegramTools } from '../tools/telegram-tools';
import { getToolAccess } from '../tools/access';
import { resolve as resolvePath } from 'path';
import { AGENT_ROOT } from '../paths';
import { createSurvivalMonitor, type SurvivalMonitor } from '../survival';
import { ChannelAuthStore } from '../channels/auth';
import { connectMcpServers } from '../mcp/defaults';
import { buildSystemPrompt as buildPrompt, type PromptCache } from './prompt-builder';
import { createMemoryManager } from './factories';
import { registerDefaultTools } from './tools-setup';
import { resolveApiKeyForProvider, getConfig } from '../config';
import { buildStopConditions, type LoopControlConfig } from '../llm/stop-conditions';
import { createTurnTracker, createPrepareStep, type TurnTracker } from '../llm/reasoning';
import type { SubAgentDeps, SubAgentProgressCallback } from '../tools/agent-tool';
import { buildToolIndex } from '../tools/tool-index';

// Re-export all types from the barrel
export type { AgentConfig, AgentState, ChatContext, ChatChannel } from './types';
import type { AgentConfig, AgentState, ChatContext } from './types';

/**
 * Options for creating a per-request ToolLoopAgent via `agent.createChatAgent()`.
 */
export interface ChatAgentOptions {
    /** The user's text message */
    userText: string;
    /** Chat context (channel, sender, admin status) */
    ctx?: ChatContext;
    /** Callback fired after each tool-loop step. Applied in ADDITION to any constructor-level onStepFinish. */
    onStepFinish?: (step: any) => void | Promise<void>;
    /** Callback fired when the entire generation completes */
    onFinish?: (result: any) => void | Promise<void>;
    /** Callback fired on stream errors */
    onError?: (event: { error: unknown }) => void;
    /** Per-request sub-agent progress callback — replaces the old singleton pattern. */
    onSubAgentProgress?: SubAgentProgressCallback;
    /** Parent abort signal — propagated to sub-agents so "stop" kills everything */
    abortSignal?: AbortSignal;
    /** Override model (skip complexity routing) */
    model?: any;
    /** Override model tier label (for logging) */
    tier?: string;
    /** Override model ID label (for logging) */
    modelId?: string;
    /** Text appended to the system prompt (e.g. Telegram resume context) */
    systemPromptSuffix?: string;
}

/**
 * Result from `createChatAgent()` — the ToolLoopAgent instance plus
 * metadata needed for logging and cost tracking after generation.
 */
/**
 * Structured schema for the agent's final response.
 * Kept for type compatibility (deliver_answer tool output shape).
 * NOT used as Output.object() — that caused extra LLM calls and "null" responses.
 */
export const AgentOutputSchema = z.object({
    answer: z.string().describe('Your complete final response to the user'),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export interface ChatAgentResult {
    /** The configured ToolLoopAgent ready for .generate() or .stream() */
    agent: ToolLoopAgent<never, ToolSet, any>;
    /** Turn tracker (for post-generation logging/failure learning) */
    reasoningCtx: TurnTracker;
    /** Resolved model tier */
    tier: string;
    /** Resolved model ID */
    modelId: string;
    /** The system prompt that was built */
    systemPrompt: string;
    /** The tools given to this agent */
    tools: Record<string, any>;
}
/**
 * Forkscout Agent — AI SDK v6 powered agent with tools, memory, and MCP.
 *
 * The agent manages:
 *   - Tool registry (core + MCP)
 *   - Memory (vector-search long-term recall)
 *   - LLM model selection + hot-swap
 *
 * The HTTP server (server.ts) handles streaming via AI SDK's streamText.
 */
export class Agent {
    private llm: LLMClient;
    private memory: MemoryManager;
    private toolSet: Record<string, any> = {};
    private config: AgentConfig;
    private state: AgentState;
    private mcpConnector: McpConnector = new McpConnector();
    private mcpConfigPath: string;
    private survival: SurvivalMonitor;
    private channelAuth: ChannelAuthStore;
    private telegramBridge: any = null;
    private router: ModelRouter;
    private promptCache: PromptCache = { defaultPrompt: null, publicPrompt: null, publicPromptToolHash: null };
    private subAgentDeps: SubAgentDeps | null = null;
    private discoveredMcpServers: import('../tools/deps').McpDeclaration[] = [];

    constructor(config: AgentConfig) {
        this.config = config;
        this.llm = new LLMClient(config.llm);
        this.router = new ModelRouter(createRouterFromEnv());
        this.state = { running: false, iterations: 0 };

        this.mcpConfigPath =
            typeof config.mcpConfig === 'string' ? config.mcpConfig : resolvePath(AGENT_ROOT, '.forkscout', 'mcp.json');

        // Subsystems
        this.memory = createMemoryManager(this.llm, this.router);

        const storagePath = resolvePath(AGENT_ROOT, '.forkscout');
        this.survival = createSurvivalMonitor({
            dataDir: storagePath,
            emergencyFlush: () => this.memory.flush(),
        });
        this.channelAuth = new ChannelAuthStore(storagePath);

        // Register tools (auto-discovered from src/tools/)
        if (config.autoRegisterDefaultTools !== false) {
            const result = registerDefaultTools(
                this.toolSet, this.mcpConnector, this.mcpConfigPath,
                this.memory, this.survival, this.channelAuth, this.router,
            );
            this.subAgentDeps = result.subAgentDeps;
            this.discoveredMcpServers = result.mcpServers;
        }
    }

    // ── Public API (used by server.ts) ─────────────────

    getModel() {
        return this.router.getModel('chat').model;
    }

    getModelForPurpose(purpose: ModelPurpose) {
        return this.router.getModel(purpose);
    }

    /** Get the chat model for a given tier (default: balanced). */
    getModelForTier(tier: ModelTier = 'balanced'): { model: any; tier: string; modelId: string } {
        return this.router.getModelByTier(tier);
    }

    /**
     * Create a fully configured ToolLoopAgent for a single chat request.
     *
     * Centralizes the parameters every call site needs:
     *   - Model selection (balanced tier by default)
     *   - System prompt (memory-enriched)
     *   - Tools (access-level filtered)
     *   - Stop conditions (budget, idle, token limit, step count)
     *   - PrepareStep (context pruning + failure escalation)
     *   - onStepFinish / onFinish callbacks
     */
    async createChatAgent(opts: ChatAgentOptions): Promise<ChatAgentResult> {
        const { userText, ctx, onStepFinish, onFinish, onSubAgentProgress } = opts;

        // Wire per-request sub-agent progress callback (replaces old singleton)
        if (onSubAgentProgress && this.subAgentDeps) {
            this.subAgentDeps.onProgress = onSubAgentProgress;
        }

        // Wire parent abort signal so "stop" kills sub-agents too
        if (opts.abortSignal && this.subAgentDeps) {
            this.subAgentDeps.parentAbortSignal = opts.abortSignal;
        }

        // 1. Build enriched system prompt (always full memory — no effort gating)
        let systemPrompt = await this.buildSystemPrompt(userText, ctx);
        if (opts.systemPromptSuffix) {
            systemPrompt += '\n\n' + opts.systemPromptSuffix;
        }

        // 2. Model selection — use override or balanced tier by default
        let chatModel = opts.model;
        let chatTier = opts.tier || 'balanced';
        let chatModelId = opts.modelId || '';

        if (!chatModel) {
            const selection = this.getModelForTier(chatTier as ModelTier);
            chatModel = selection.model;
            chatTier = selection.tier;
            chatModelId = selection.modelId;
            console.log(`[Router]: Using ${chatTier} tier (${chatModelId})`);
        }

        // 3. Tools — filtered by access level
        const tools = this.getToolsForContext(ctx);

        // 4. Turn tracker — handles context pruning + failure escalation
        const allToolNames = Object.keys(tools);
        const dynamicToolLoading = getConfig().agent.dynamicToolLoading ?? false;
        const reasoningCtx = createTurnTracker(
            userText, chatTier as ModelTier,
            systemPrompt, this.router,
            [], allToolNames, dynamicToolLoading,
        );

        // 5. Stop conditions — always use maxSteps from config
        const agentCfg = getConfig().agent;
        const adaptiveConfig: LoopControlConfig = {
            ...agentCfg,
        };
        console.log(`[StopConditions]: maxSteps=${adaptiveConfig.maxSteps}`);

        // 6. Build the ToolLoopAgent with all configuration
        const agent = new ToolLoopAgent({
            id: `forkscout-${ctx?.channel || 'chat'}`,
            model: chatModel,
            instructions: systemPrompt,
            tools,
            maxRetries: agentCfg.agentMaxRetries,
            stopWhen: buildStopConditions(adaptiveConfig),
            prepareStep: createPrepareStep(reasoningCtx),
            // No Output.object() — that forces an extra LLM step which reliably produces
            // "null" or hallucinated answers when the model is uncertain.
            // Instead we rely on result.text → deliver_answer → step-text fallback
            // (see resolveAgentResponse in utils/resolve-response.ts).
            onStepFinish: onStepFinish ? (step: any) => { onStepFinish(step); } : undefined,
            onFinish: onFinish ? (result: any) => { onFinish(result); } : undefined,
        });

        return { agent, reasoningCtx, tier: chatTier, modelId: chatModelId, systemPrompt, tools };
    }

    getRouter(): ModelRouter {
        return this.router;
    }

    /**
     * Hot-reload: apply a fresh config to the running agent.
     * Swaps LLM client settings and router tiers without restarting the process.
     */
    reloadConfig(cfg: import('../config').ForkscoutConfig): void {
        // Rebuild LLM client config
        this.config.llm = {
            provider: cfg.provider as any,
            model: cfg.model,
            baseURL: cfg.baseURL,
            apiKey: resolveApiKeyForProvider(cfg.provider),
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
        };
        this.llm = new LLMClient(this.config.llm);

        // Hot-swap router tiers (preserves usage state)
        this.router.reloadConfig(createRouterFromEnv());

        console.log(`[Agent↻] Config reloaded — provider: ${cfg.provider}, model: ${cfg.model}`);
    }

    getTools(): Record<string, any> {
        return { ...this.toolSet };
    }

    setTelegramBridge(bridge: any): void {
        this.telegramBridge = bridge;
        Object.assign(this.toolSet, createTelegramTools(bridge, this.channelAuth));
        // Rebuild tool index to include telegram tools
        if (this.state.running) buildToolIndex(this.toolSet);
        console.log(`[Agent]: Telegram messaging tools registered`);
    }

    getTelegramBridge(): any {
        return this.telegramBridge;
    }

    /**
     * Clear the sub-agent progress callback after a request completes.
     * Called by channel handlers in their finally blocks.
     */
    clearSubAgentProgress(): void {
        if (this.subAgentDeps) {
            this.subAgentDeps.onProgress = undefined;
            this.subAgentDeps.parentAbortSignal = undefined;
        }
    }

    getToolList(): Array<{ name: string; description: string }> {
        return Object.entries(this.toolSet).map(([name, t]) => ({
            name,
            description: (t as any).description || '',
        }));
    }

    // ── System Prompt ──────────────────────────────────

    async buildSystemPrompt(userQuery: string, ctx?: ChatContext): Promise<string> {
        const guestTools = ctx?.isAdmin ? undefined : this.getToolsForContext(ctx);
        return buildPrompt(this.config, this.memory, this.survival, this.promptCache, this.router, userQuery, ctx, guestTools);
    }

    // ── Memory ─────────────────────────────────────────

    saveToMemory(role: 'user' | 'assistant', content: string, ctx?: ChatContext): void {
        const channel = ctx?.channel;
        if (ctx && role === 'user' && ctx.sender) {
            this.memory.addMessage(role, `[${ctx.sender} via ${ctx.channel}] ${content}`, channel);
        } else {
            this.memory.addMessage(role, content, channel);
        }

        if (role === 'assistant' && ctx?.sender) {
            try {
                const recentMessages = this.memory.getRecentHistoryWithTimestamps(10);
                this.memory.updateEntitySession(ctx.sender, recentMessages, ctx.channel);
            } catch (err) {
                console.warn(`[Agent]: Entity session update failed for ${ctx.sender}: ${err instanceof Error ? (err as Error).message : err}`);
            }
        }
    }

    // ── Lifecycle ──────────────────────────────────────

    async init(): Promise<void> {
        if (this.state.running) return;
        await this.memory.init();
        await this.channelAuth.init();
        const mcpCfg = typeof this.config.mcpConfig === 'object' ? this.config.mcpConfig : undefined;
        await connectMcpServers(mcpCfg, this.mcpConfigPath, this.mcpConnector, this.toolSet, this.discoveredMcpServers);
        await this.survival.start();

        // Build tool index for Tool RAG (search_available_tools) — must happen after all tools are registered
        buildToolIndex(this.toolSet);

        this.state.running = true;
    }

    async stop(): Promise<void> {
        this.state.running = false;
        this.router.getUsage().stop();
        await this.survival.stop();
        await this.mcpConnector.disconnect();
        await this.survival.withWriteAccess(() => this.memory.flush());
        console.log('\nAgent stopped (memory + usage saved)');
    }

    // ── Accessors ──────────────────────────────────────

    getMemoryManager(): MemoryManager { return this.memory; }
    getState(): AgentState { return { ...this.state }; }
    getLLMClient(): LLMClient { return this.llm; }
    getSurvival(): SurvivalMonitor { return this.survival; }
    getChannelAuth(): ChannelAuthStore { return this.channelAuth; }

    getToolsForContext(ctx?: ChatContext): Record<string, any> {
        if (ctx?.isAdmin) return { ...this.toolSet };
        const filtered: Record<string, any> = {};
        for (const [name, t] of Object.entries(this.toolSet)) {
            if (getToolAccess(t) === 'guest') filtered[name] = t;
        }
        return filtered;
    }
}
