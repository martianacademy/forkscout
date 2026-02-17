import { LLMClient } from '../llm/client';
import { ModelRouter, createRouterFromEnv, type ModelPurpose } from '../llm/router';
import { MemoryManager } from '../memory/manager';
import type { Scheduler, CronAlert } from '../scheduler';
import { McpConnector } from '../mcp/connector';
import { createTelegramTools } from '../tools/ai-tools';
import { resolve as resolvePath } from 'path';
import { AGENT_ROOT } from '../paths';
import { SurvivalMonitor } from '../survival';
import { ChannelAuthStore } from '../channel-auth';
import { connectMcpServers } from '../mcp/defaults';
import { buildSystemPrompt as buildPrompt, type PromptCache } from './prompt-builder';
import { createMemoryManager, createScheduler } from './factories';
import { registerDefaultTools } from './tools-setup';

// Re-export all types from the barrel
export type { AgentConfig, AgentState, ChatContext, ChatChannel } from './types';
import type { AgentConfig, AgentState, ChatContext } from './types';

/**
 * Forkscout Agent — AI SDK v6 powered agent with tools, memory, and MCP.
 *
 * The agent manages:
 *   - Tool registry (core + scheduler + MCP)
 *   - Memory (vector-search long-term recall)
 *   - Scheduler (cron jobs with urgency evaluation)
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
    private scheduler: Scheduler;
    private urgentAlerts: CronAlert[] = [];
    private mcpConnector: McpConnector = new McpConnector();
    private mcpConfigPath: string;
    private survival: SurvivalMonitor;
    private channelAuth: ChannelAuthStore;
    private telegramBridge: any = null;
    private router: ModelRouter;
    private promptCache: PromptCache = { defaultPrompt: null, publicPrompt: null };

    constructor(config: AgentConfig) {
        this.config = config;
        this.llm = new LLMClient(config.llm);
        this.router = new ModelRouter(createRouterFromEnv());
        this.state = { running: false, iterations: 0 };

        this.mcpConfigPath =
            typeof config.mcpConfig === 'string' ? config.mcpConfig : resolvePath(AGENT_ROOT, '.forkscout', 'mcp.json');

        // Subsystems
        this.memory = createMemoryManager(this.llm, this.router);
        this.scheduler = createScheduler(this.router, (alert) => {
            this.urgentAlerts.push(alert);
            console.log(`\n🚨 URGENT ALERT from "${alert.jobName}": ${alert.output.slice(0, 300)}`);
        });

        const storagePath = resolvePath(AGENT_ROOT, '.forkscout');
        this.survival = new SurvivalMonitor({
            dataDir: storagePath,
            emergencyFlush: () => this.memory.flush(),
        });
        this.channelAuth = new ChannelAuthStore(storagePath);

        // Register tools
        if (config.autoRegisterDefaultTools !== false) {
            registerDefaultTools(
                this.toolSet, this.scheduler, this.mcpConnector, this.mcpConfigPath,
                this.memory, this.survival, this.channelAuth, this.router,
            );
        }
    }

    // ── Public API (used by server.ts) ─────────────────

    getModel() {
        return this.router.getModel('chat').model;
    }

    getModelForPurpose(purpose: ModelPurpose) {
        return this.router.getModel(purpose);
    }

    getRouter(): ModelRouter {
        return this.router;
    }

    getTools(): Record<string, any> {
        return { ...this.toolSet };
    }

    setTelegramBridge(bridge: any): void {
        this.telegramBridge = bridge;
        Object.assign(this.toolSet, createTelegramTools(bridge, this.channelAuth));
        console.log(`[Agent]: Telegram messaging tools registered`);
    }

    getTelegramBridge(): any {
        return this.telegramBridge;
    }

    getToolList(): Array<{ name: string; description: string }> {
        return Object.entries(this.toolSet).map(([name, t]) => ({
            name,
            description: (t as any).description || '',
        }));
    }

    // ── System Prompt ──────────────────────────────────

    async buildSystemPrompt(userQuery: string, ctx?: ChatContext): Promise<string> {
        return buildPrompt(this.config, this.memory, this.survival, this.urgentAlerts, this.promptCache, userQuery, ctx);
    }

    // ── Memory ─────────────────────────────────────────

    saveToMemory(role: 'user' | 'assistant', content: string, ctx?: ChatContext): void {
        if (ctx && role === 'user' && ctx.sender) {
            this.memory.addMessage(role, `[${ctx.sender} via ${ctx.channel}] ${content}`);
        } else {
            this.memory.addMessage(role, content);
        }

        if (role === 'assistant' && ctx?.sender) {
            try {
                const recentMessages = this.memory.getRecentHistoryWithTimestamps(10);
                this.memory.updateEntitySession(ctx.sender, recentMessages, ctx.channel);
            } catch {
                /* non-critical */
            }
        }
    }

    // ── Lifecycle ──────────────────────────────────────

    async init(): Promise<void> {
        if (this.state.running) return;
        await this.memory.init();
        await this.channelAuth.init();
        const mcpCfg = typeof this.config.mcpConfig === 'object' ? this.config.mcpConfig : undefined;
        await connectMcpServers(mcpCfg, this.mcpConfigPath, this.mcpConnector, this.toolSet);
        await this.survival.start();
        this.state.running = true;
    }

    async stop(): Promise<void> {
        this.state.running = false;
        this.scheduler.stopAll();
        this.router.getBudget().stop();
        await this.survival.stop();
        await this.mcpConnector.disconnect();
        await this.survival.withWriteAccess(() => this.memory.flush());
        console.log('\nAgent stopped (memory + budget saved)');
    }

    // ── Accessors ──────────────────────────────────────

    getMemoryManager(): MemoryManager { return this.memory; }
    getState(): AgentState { return { ...this.state }; }
    getLLMClient(): LLMClient { return this.llm; }
    getSurvival(): SurvivalMonitor { return this.survival; }
    getChannelAuth(): ChannelAuthStore { return this.channelAuth; }

    getToolsForContext(ctx?: ChatContext): Record<string, any> {
        if (ctx?.isAdmin) return { ...this.toolSet };
        const GUEST_TOOLS = new Set(['web_search', 'browse_web', 'get_current_date']);
        const filtered: Record<string, any> = {};
        for (const [name, t] of Object.entries(this.toolSet)) {
            if (GUEST_TOOLS.has(name)) filtered[name] = t;
        }
        return filtered;
    }
}
