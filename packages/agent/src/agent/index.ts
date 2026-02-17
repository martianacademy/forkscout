import { generateTextQuiet } from '../llm/retry';
import { LLMClient } from '../llm/client';
import { ModelRouter, createRouterFromEnv, type ModelPurpose } from '../llm/router';
import { MemoryManager } from '../memory/manager';
import { Scheduler, type CronAlert } from '../scheduler';
import { McpConnector } from '../mcp/connector';
import {
    coreTools,
    createSchedulerTools,
    createMcpTools,
    createMemoryTools,
    createSurvivalTools,
    createChannelAuthTools,
    createTelegramTools,
    createBudgetTools,
} from '../tools/ai-tools';
import { exec } from 'child_process';
import { getShell } from '../utils/shell';
import { resolve as resolvePath } from 'path';
import { AGENT_ROOT } from '../paths';
import { getConfig } from '../config';
import { SurvivalMonitor } from '../survival';
import { ChannelAuthStore } from '../channel-auth';
import { connectMcpServers } from './mcp';
import { buildSystemPrompt as buildPrompt, type PromptCache } from './prompt-builder';

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
    private telegramBridge: any = null; // Set by server.ts after bridge creation
    private router: ModelRouter;
    private promptCache: PromptCache = { defaultPrompt: null, publicPrompt: null };

    constructor(config: AgentConfig) {
        this.config = config;
        this.llm = new LLMClient(config.llm);

        // Multi-model router with budget tracking
        const routerConfig = createRouterFromEnv();
        this.router = new ModelRouter(routerConfig);

        // Resolve MCP config path early so tools can use it
        this.mcpConfigPath =
            typeof config.mcpConfig === 'string' ? config.mcpConfig : resolvePath(AGENT_ROOT, '.forkscout', 'mcp.json');

        // Smart memory with vector search + knowledge graph + session summaries
        const storagePath = resolvePath(AGENT_ROOT, '.forkscout');

        this.memory = new MemoryManager({
            storagePath,
            embeddingModel: this.llm.getEmbeddingModel(),
            ownerName: getConfig().agent.owner,
            recentWindowSize: 6,
            relevantMemoryLimit: 5,
            contextBudget: 4000,
            summarizer: async (text: string) => {
                return generateTextQuiet({
                    model: this.router.getModel('summarize').model,
                    system: 'You are a summarization assistant. Be concise and accurate.',
                    prompt: `Summarize this conversation into 2-3 concise sentences capturing the key topics, decisions, and outcomes:\n\n${text}`,
                });
            },
            entityExtractor: async (prompt: string) => {
                return generateTextQuiet({
                    model: this.router.getModel('extract').model,
                    system: 'You are an entity extraction bot. Return ONLY valid JSON, no markdown.',
                    prompt,
                });
            },
        });

        this.state = { running: false, iterations: 0 };

        // Create scheduler with command runner, urgency evaluator, and disk persistence
        const schedulerPersistPath = resolvePath(AGENT_ROOT, '.forkscout', 'scheduler-jobs.json');
        this.scheduler = new Scheduler(
            (command: string) =>
                new Promise((resolve, reject) => {
                    exec(
                        command,
                        { timeout: 30_000, maxBuffer: 1024 * 1024, shell: getShell() },
                        (error: Error | null, stdout: string, stderr: string) => {
                            if (error && !stdout && !stderr) reject(error);
                            else resolve((stdout || '').trim() + (stderr ? `\n[stderr]: ${stderr.trim()}` : ''));
                        },
                    );
                }),
            async (jobName: string, watchFor: string | undefined, output: string) => {
                if (!watchFor) return 'normal';
                try {
                    const response = await generateTextQuiet({
                        model: this.router.getModel('classify').model,
                        system: 'You are a classification bot. Reply with exactly one word.',
                        prompt: `A cron job named "${jobName}" just ran.\nWatch for: "${watchFor}"\n\nOutput:\n${output.slice(0, 1500)}\n\nClassify as exactly one word: normal, important, or urgent`,
                    });
                    const level = response.trim().toLowerCase();
                    return level === 'urgent' || level === 'important' ? (level as any) : 'normal';
                } catch {
                    return 'normal';
                }
            },
            schedulerPersistPath,
        );

        // Restore any previously-persisted cron jobs
        this.scheduler
            .restoreJobs()
            .catch((err) =>
                console.error(`⚠️ Scheduler restore failed: ${err instanceof Error ? err.message : String(err)}`),
            );

        // Listen for urgent alerts
        this.scheduler.on('urgent', (alert: CronAlert) => {
            this.urgentAlerts.push(alert);
            console.log(`\n🚨 URGENT ALERT from "${alert.jobName}": ${alert.output.slice(0, 300)}`);
        });

        // Survival monitor — self-preservation system
        const storagePath2 = resolvePath(AGENT_ROOT, '.forkscout');
        this.survival = new SurvivalMonitor({
            dataDir: storagePath2,
            emergencyFlush: () => this.memory.flush(),
        });

        // Channel authorization store — tracks external channel users + grants
        this.channelAuth = new ChannelAuthStore(storagePath2);

        // Register tools
        if (config.autoRegisterDefaultTools !== false) {
            this.registerDefaultTools();
        }
    }

    // ── Tool Registration ──────────────────────────────

    private registerDefaultTools(): void {
        // Core tools (file, shell, web, utility)
        Object.assign(this.toolSet, coreTools);

        // Scheduler tools (cron jobs)
        Object.assign(this.toolSet, createSchedulerTools(this.scheduler));

        // MCP management tools (add/remove/list servers at runtime)
        Object.assign(
            this.toolSet,
            createMcpTools(
                this.mcpConnector,
                (newTools) => Object.assign(this.toolSet, newTools),
                (names) => {
                    for (const n of names) delete this.toolSet[n];
                },
                this.mcpConfigPath,
            ),
        );

        // Memory tools (save/search/clear knowledge)
        Object.assign(this.toolSet, createMemoryTools(this.memory));

        // Survival tools (vitals, backup, status)
        Object.assign(this.toolSet, createSurvivalTools(this.survival));

        // Channel authorization tools (list/grant/revoke channel users)
        Object.assign(this.toolSet, createChannelAuthTools(this.channelAuth));

        // Budget & model tier tools (check spending, switch models)
        Object.assign(this.toolSet, createBudgetTools(this.router));
    }

    // ── Public API (used by server.ts) ─────────────────

    /** Get the AI SDK LanguageModelV1 instance (uses balanced tier by default) */
    getModel() {
        return this.router.getModel('chat').model;
    }

    /** Get a model for a specific purpose (respects budget) */
    getModelForPurpose(purpose: ModelPurpose) {
        return this.router.getModel(purpose);
    }

    /** Get the model router instance */
    getRouter(): ModelRouter {
        return this.router;
    }

    /** Get all registered tools as an AI SDK ToolSet */
    getTools(): Record<string, any> {
        return { ...this.toolSet };
    }

    /** Set the Telegram bridge reference (called by server.ts) */
    setTelegramBridge(bridge: any): void {
        this.telegramBridge = bridge;
        // Register telegram messaging tools now that bridge is available
        Object.assign(this.toolSet, createTelegramTools(bridge, this.channelAuth));
        console.log(`[Agent]: Telegram messaging tools registered`);
    }

    /** Get the Telegram bridge (if connected) */
    getTelegramBridge(): any {
        return this.telegramBridge;
    }

    /** Get tool list (name + description) for status endpoints */
    getToolList(): Array<{ name: string; description: string }> {
        return Object.entries(this.toolSet).map(([name, t]) => ({
            name,
            description: (t as any).description || '',
        }));
    }

    // ── System Prompt ──────────────────────────────────

    /**
     * Build the system prompt, enriched with memory context for the given user query.
     * Injects access control rules based on whether the user is admin.
     */
    async buildSystemPrompt(userQuery: string, ctx?: ChatContext): Promise<string> {
        return buildPrompt(this.config, this.memory, this.survival, this.urgentAlerts, this.promptCache, userQuery, ctx);
    }

    // ── Memory ─────────────────────────────────────────

    /** Save a message to memory for future vector-search retrieval */
    saveToMemory(role: 'user' | 'assistant', content: string, ctx?: ChatContext): void {
        // Prefix user messages with sender/channel for memory recall
        if (ctx && role === 'user' && ctx.sender) {
            this.memory.addMessage(role, `[${ctx.sender} via ${ctx.channel}] ${content}`);
        } else {
            this.memory.addMessage(role, content);
        }

        // After each assistant reply, update the sender's entity with the latest session.
        // This keeps each person's knowledge graph entity current with recent conversation,
        // surviving restarts naturally — no separate session file needed.
        if (role === 'assistant' && ctx?.sender) {
            try {
                const recentMessages = this.memory.getRecentHistoryWithTimestamps(10);
                this.memory.updateEntitySession(ctx.sender, recentMessages, ctx.channel);
            } catch {
                /* non-critical — don't break the response */
            }
        }
    }

    // ── Lifecycle ──────────────────────────────────────

    /** Initialize agent (memory + MCP connections + survival monitor + channel auth). Safe to call multiple times. */
    async init(): Promise<void> {
        if (this.state.running) return;
        await this.memory.init();
        await this.channelAuth.init();
        await connectMcpServers(this.config, this.mcpConfigPath, this.mcpConnector, this.toolSet);
        await this.survival.start();
        this.state.running = true;
    }

    /** Stop the agent, flush memory, disconnect MCP servers, stop survival monitor, save budget */
    async stop(): Promise<void> {
        this.state.running = false;
        this.scheduler.stopAll();
        this.router.getBudget().stop();
        await this.survival.stop();
        await this.mcpConnector.disconnect();
        // Use survival's write-access guard if root (lifts immutable flags for final flush)
        await this.survival.withWriteAccess(() => this.memory.flush());
        console.log('\nAgent stopped (memory + budget saved)');
    }

    // ── Accessors ──────────────────────────────────────

    getMemoryManager(): MemoryManager {
        return this.memory;
    }
    getState(): AgentState {
        return { ...this.state };
    }
    getLLMClient(): LLMClient {
        return this.llm;
    }
    getSurvival(): SurvivalMonitor {
        return this.survival;
    }
    getChannelAuth(): ChannelAuthStore {
        return this.channelAuth;
    }

    /**
     * Get a filtered tool set based on admin status.
     * Non-admin users get a minimal safe set — no file access, no shell, no memory, no self-edit.
     */
    getToolsForContext(ctx?: ChatContext): Record<string, any> {
        if (ctx?.isAdmin) return { ...this.toolSet };

        // Guest tool allowlist — safe, read-only, non-sensitive
        const GUEST_TOOLS = new Set(['web_search', 'browse_web', 'get_current_date']);
        const filtered: Record<string, any> = {};
        for (const [name, t] of Object.entries(this.toolSet)) {
            if (GUEST_TOOLS.has(name)) filtered[name] = t;
        }
        return filtered;
    }
}
