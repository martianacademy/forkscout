/**
 * MemoryManager — remote-only facade over the Forkscout Memory MCP Server.
 * All reads/writes are delegated to the MCP server (single source of truth).
 * @module memory/index
 */

import { RemoteMemoryStore } from './remote-store';
import type { MemoryConfig, ContextResult, SearchResult, Entity, EntityType, Relation, RelationType, ActiveTask, TaskStatus } from './types';
import { SELF_ENTITY_NAME, RELATION_TYPES } from './types';

export { SELF_ENTITY_NAME, RELATION_TYPES };
export type { MemoryConfig, ContextResult, SearchResult, Entity, EntityType, Relation, RelationType, ActiveTask, TaskStatus };

/** Build a failure observation string from a reasoning context + response. */
export function buildFailureObservation(
    ctx: { toolFailures: Array<{ toolName: string; error: string }>; userMessage: string },
    finalText: string,
): string | null {
    if (!ctx.toolFailures || ctx.toolFailures.length === 0) return null;
    const resolved = finalText.length > 50;
    const failures = ctx.toolFailures.slice(0, 5).map(f => `${f.toolName}: ${f.error.slice(0, 100)}`).join('; ');
    return resolved
        ? `[FAILURE→RESOLVED] "${ctx.userMessage.slice(0, 100)}": ${failures}. Fix: ${finalText.slice(0, 150)}`
        : `[FAILURE→UNRESOLVED] "${ctx.userMessage.slice(0, 100)}": ${failures}`;
}

interface RecentMsg { role: 'user' | 'assistant'; content: string; timestamp: Date; channel?: string }

export class MemoryManager {
    private store: RemoteMemoryStore;
    private config: MemoryConfig;
    private sessionId = `session_${Date.now()}`;
    private recentMessages: RecentMsg[] = [];
    /** Per-channel pending user messages — prevents cross-channel exchange pairing corruption. */
    private pendingUser = new Map<string, string>();
    private selfContextCache: string | null = null;
    private selfContextLastFetch = 0;
    private static readonly SELF_CACHE_TTL_MS = 60_000; // refresh self-entity every 60s
    /** Active project for scoped memory searches. Set via setProject(). */
    private activeProject: string | undefined;

    constructor(config: MemoryConfig) {
        this.config = { recentWindowSize: 6, contextBudget: 4000, ...config };

        if (!config.mcpUrl) {
            throw new Error('MemoryManager requires mcpUrl — set agent.forkscoutMemoryMcpUrl in config or MEMORY_MCP_URL env');
        }

        console.log(`🧠 Memory: remote mode → ${config.mcpUrl}`);
        this.store = new RemoteMemoryStore(config.mcpUrl);
    }

    // ── Lifecycle ────────────────────────────────────

    async init(): Promise<void> {
        await this.store.init();

        // If memory is unreachable, skip history restore
        if (!this.store.isHealthy) return;

        // Restore recent conversation history from MCP so we have context after restart
        try {
            const restored = await this.store.getRecentExchangesAsync(this.config.recentWindowSize ?? 6);
            if (restored.length > 0) {
                for (const ex of restored) {
                    if (ex.user) this.recentMessages.push({ role: 'user', content: ex.user, timestamp: new Date(ex.timestamp || Date.now()) });
                    if (ex.assistant) this.recentMessages.push({ role: 'assistant', content: ex.assistant, timestamp: new Date(ex.timestamp || Date.now()) });
                }
                console.log(`🧠 Restored ${restored.length} exchange(s) from previous sessions`);
            }
        } catch (err) {
            console.warn(`[Memory]: Failed to restore conversation history: ${err instanceof Error ? err.message : err}`);
        }

        // Pre-fetch self-entity so it's warm for first prompt
        try { await this.refreshSelfContext(); } catch (err) {
            console.warn(`[Memory]: Self-entity pre-fetch failed: ${err instanceof Error ? err.message : err}`);
        }
    }

    async flush(): Promise<void> {
        for (const [_ch, content] of this.pendingUser) {
            this.store.addExchange(content, '', this.sessionId);
        }
        this.pendingUser.clear();
        await this.store.flush();
    }

    async clear(): Promise<void> {
        this.recentMessages = [];
        this.pendingUser.clear();
        await this.store.clear();
    }

    // ── Project context ──────────────────────────────

    /** Set the active project for scoped memory searches. Null clears it. */
    setProject(project: string | undefined): void {
        if (this.activeProject !== project) {
            console.log(`🧠 Memory project scope: ${project || '(global)'}`);
        }
        this.activeProject = project;
    }

    /** Get the currently active project scope. */
    getProject(): string | undefined { return this.activeProject; }

    // ── Message handling ─────────────────────────────

    /**
     * Add a message to recent history. Channel tag enables per-channel isolation:
     * - pendingUser pairing is per-channel (no cross-channel exchange corruption)
     * - getRecentHistory can filter by channel for guest isolation
     */
    addMessage(role: 'user' | 'assistant', content: string, channel?: string): void {
        this.recentMessages.push({ role, content, timestamp: new Date(), channel });
        const key = channel || '_default';
        if (role === 'user') {
            this.pendingUser.set(key, content);
        } else if (role === 'assistant' && this.pendingUser.has(key)) {
            const tags = this.activeProject ? { project: this.activeProject } : undefined;
            this.store.addExchange(this.pendingUser.get(key)!, content, this.sessionId, tags);
            this.pendingUser.delete(key);
        }
    }

    /**
     * Get recent history, optionally filtered by channel.
     * - No channel filter: returns all messages (for admins who see everything)
     * - With channel filter: returns only that channel's messages (for guests/isolation)
     */
    getRecentHistory(limit?: number, channel?: string): Array<{ role: 'user' | 'assistant'; content: string }> {
        const n = limit ?? this.config.recentWindowSize ?? 20;
        const msgs = channel
            ? this.recentMessages.filter(m => m.channel === channel)
            : this.recentMessages;
        return msgs.slice(-n).map(({ role, content }) => ({ role, content }));
    }

    getRecentHistoryWithTimestamps(limit?: number, channel?: string): RecentMsg[] {
        const n = limit ?? this.config.recentWindowSize ?? 20;
        const msgs = channel
            ? this.recentMessages.filter(m => m.channel === channel)
            : this.recentMessages;
        return msgs.slice(-n);
    }

    /**
     * Get recent history with channel labels — for admin cross-channel awareness.
     * Returns messages from ALL channels with [channel] prefix so the model knows
     * who said what and where.
     */
    getRecentHistoryLabeled(limit?: number): Array<{ role: 'user' | 'assistant'; content: string; channel?: string }> {
        const n = limit ?? this.config.recentWindowSize ?? 20;
        return this.recentMessages.slice(-n).map(({ role, content, channel: ch }) => ({
            role, content, channel: ch,
        }));
    }

    // ── Context building ─────────────────────────────

    async buildContext(query: string): Promise<ContextResult> {
        const windowSize = this.config.recentWindowSize ?? 20;
        const budget = this.config.contextBudget ?? 8000;
        const recent = this.recentMessages.slice(-windowSize);
        const recentStr = recent
            .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
            .join('\n');

        let graphContext = '';
        let relevantMemories = '';
        let retrievedCount = 0;
        let graphEntities = 0;

        // 1. Knowledge search — graph entities + some exchanges (project-scoped)
        try {
            const results = await this.store.searchKnowledgeAsync(query, 8, this.activeProject);
            const graphLines: string[] = [];
            const exchangeLines: string[] = [];
            for (const r of results) {
                if (r.source === 'graph') { graphLines.push(`• ${r.content}`); graphEntities++; }
                else { exchangeLines.push(`[Past] ${r.content}`); retrievedCount++; }
            }
            if (graphLines.length) graphContext = '\n\n[Knowledge Graph]\n' + graphLines.join('\n');
            if (exchangeLines.length) relevantMemories = '\n\nRelevant memories from past conversations:\n' + exchangeLines.join('\n\n');
        } catch (err) {
            console.warn(`[Memory]: Knowledge search failed for "${query.slice(0, 50)}": ${err instanceof Error ? err.message : err}`);
        }

        // 2. Dedicated exchange search — ensures past conversations are always represented
        //    Uses a broader query so context-light messages ("continue", "yes") still retrieve history
        try {
            const exchangeQuery = query.length < 20 ? '*' : query;
            const exchanges = await this.store.searchExchangesAsync(exchangeQuery, 5, this.activeProject);
            if (exchanges.length > 0) {
                const seen = new Set(relevantMemories.split('\n').map(l => l.trim()));
                const newLines: string[] = [];
                for (const ex of exchanges) {
                    const userSnippet = (ex.user || '').slice(0, 200);
                    const assistantSnippet = (ex.assistant || '').slice(0, 300);
                    const line = `[Exchange] User: ${userSnippet} → Assistant: ${assistantSnippet}`;
                    if (!seen.has(line)) { newLines.push(line); retrievedCount++; }
                }
                if (newLines.length) {
                    relevantMemories += (relevantMemories ? '\n\n' : '\n\nRelevant memories from past conversations:\n') + newLines.join('\n\n');
                }
            }
        } catch (err) {
            console.warn(`[Memory]: Exchange search failed: ${err instanceof Error ? err.message : err}`);
        }

        // 3. Enforce context budget — rough char estimate (1 token ≈ 4 chars)
        const totalChars = recentStr.length + graphContext.length + relevantMemories.length;
        const charBudget = budget * 4;
        if (totalChars > charBudget) {
            // Trim relevant memories first (least critical), then graph
            const overhead = totalChars - charBudget;
            if (relevantMemories.length > overhead) {
                relevantMemories = relevantMemories.slice(0, relevantMemories.length - overhead) + '\n[...truncated]';
            } else {
                const savedLen = relevantMemories.length;
                relevantMemories = '';
                const remaining = overhead - savedLen;
                if (graphContext.length > remaining) {
                    graphContext = graphContext.slice(0, graphContext.length - remaining) + '\n[...truncated]';
                }
            }
        }

        return {
            recentHistory: recentStr,
            relevantMemories,
            graphContext,
            skillContext: '',
            stats: { recentCount: recent.length, retrievedCount, graphEntities, totalChunks: 0, skillCount: 0, situation: { primary: [], goal: '' } },
        };
    }

    // ── Knowledge operations ─────────────────────────

    async saveKnowledge(fact: string, category?: string, project?: string): Promise<void> {
        await this.store.callTool('save_knowledge', {
            fact, category,
            ...(project || this.activeProject ? { project: project || this.activeProject } : {}),
        });
    }

    async searchKnowledge(query: string, limit = 5, project?: string): Promise<SearchResult[]> {
        return this.store.searchKnowledgeAsync(query, limit, project || this.activeProject);
    }

    async searchEntities(query: string, limit = 5, project?: string): Promise<Entity[]> {
        return this.store.searchEntitiesAsync(query, limit, project || this.activeProject);
    }

    // ── Entity operations ────────────────────────────

    addEntity(name: string, type: EntityType, facts: string[]): Entity {
        return this.store.addEntity(name, type, facts);
    }
    getEntity(name: string) { return this.store.getEntity(name); }
    getAllEntities() { return this.store.getAllEntities(); }
    getAllRelations() { return this.store.getAllRelations(); }
    addRelation(from: string, type: RelationType, to: string) { return this.store.addRelation(from, type, to); }

    // ── Self-identity ────────────────────────────────

    getSelfContext(): string {
        // Return cached self-context (refreshed async by getSelfContextAsync)
        return this.selfContextCache || '';
    }

    /** Fetch self-entity from MCP and format as context string. Cached with TTL.
     *  @param query — when provided, returns only the most relevant facts (scored by relevance).
     *                 Without query, returns all facts (can be 30 K+ tokens — avoid in hot path). */
    async getSelfContextAsync(query?: string): Promise<string> {
        // Filtered requests always go to MCP (no cache — query changes each time)
        if (query) return this.refreshSelfContext(query, 30);

        const now = Date.now();
        if (this.selfContextCache !== null && now - this.selfContextLastFetch < MemoryManager.SELF_CACHE_TTL_MS) {
            return this.selfContextCache;
        }
        // Unfiltered: fetch all but only cache top 40
        return this.refreshSelfContext(undefined, 40);
    }

    private async refreshSelfContext(query?: string, limit?: number): Promise<string> {
        try {
            const selfEntity = await this.store.getSelfEntityAsync(query, limit);
            const formatted = selfEntity && selfEntity.facts && selfEntity.facts.length > 0
                ? selfEntity.facts
                    .map(f => typeof f === 'string' ? `• ${f}` : `• [${Math.round(f.confidence * 100)}%] ${f.content}`)
                    .join('\n')
                : '';
            // Only update the general cache when not doing a query-specific fetch
            if (!query) {
                this.selfContextCache = formatted;
                this.selfContextLastFetch = Date.now();
            }
            return formatted;
        } catch {
            // Keep existing cache on failure
            if (this.selfContextCache === null) this.selfContextCache = '';
            return this.selfContextCache;
        }
    }

    recordSelfObservation(content: string, _category?: string): void { this.store.addSelfObservation(content); }

    /**
     * Save a behavioral rule for a person. These are durable preferences/corrections
     * that must be respected in ALL future conversations with this person.
     * Stored as facts on their person entity, prefixed with [RULE] for easy retrieval.
     */
    saveBehavioralRule(personName: string, rule: string, category: string): void {
        const fact = `[RULE:${category}] ${rule}`;
        this.store.addEntity(personName, 'person', [fact]);
        console.log(`[Memory]: Saved behavioral rule for ${personName}: ${fact}`);
    }

    /**
     * Get all behavioral rules for a person from their entity facts.
     * Returns rules as an array of strings, or empty if none found.
     */
    async getBehavioralRules(personName: string): Promise<string[]> {
        try {
            const entity = await this.store.getEntityAsync(personName);
            if (!entity?.facts) return [];
            return entity.facts
                .filter((f: any) => {
                    const content = typeof f === 'string' ? f : f.content;
                    return content?.startsWith('[RULE:');
                })
                .map((f: any) => typeof f === 'string' ? f : f.content);
        } catch {
            return [];
        }
    }

    updateEntitySession(
        entityName: string,
        _exchanges: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>,
        _channel?: string,
    ): void {
        this.store.addEntity(entityName, 'person', [`Active conversation partner`]);
    }

    // ── Stats ────────────────────────────────────────

    getStats() {
        return {
            entities: this.store.entityCount,
            relations: this.store.relationCount,
            exchanges: this.store.exchangeCount,
            activeTasks: this.store.tasks.runningCount,
            totalTasks: this.store.tasks.totalCount,
        };
    }

    getStore(): RemoteMemoryStore { return this.store; }

    // ── Consolidation (delegated to MCP server) ─────

    /**
     * Manually trigger a consolidation pass via the MCP server.
     * The MCP server also runs this automatically on a periodic timer.
     */
    async runConsolidation(): Promise<string> {
        return this.store.callTool('consolidate_memory', {});
    }

    /** Get stale entities via the MCP server. */
    async getStaleEntities(maxAgeDays = 30): Promise<string> {
        return this.store.callTool('get_stale_entities', { maxAgeDays });
    }

    // ── Active tasks (executive memory) ──────────────

    createTask(title: string, goal: string, opts?: {
        budgetRemaining?: number;
        successCondition?: string;
    }): ActiveTask {
        return this.store.tasks.create(title, goal, opts);
    }

    getTask(id: string) { return this.store.tasks.get(id); }
    getRunningTasks() { return this.store.tasks.getByStatus('running'); }
    getAllTasks() { return this.store.tasks.getAll(); }

    completeTask(id: string, reason?: string) { return this.store.tasks.complete(id, reason); }
    abortTask(id: string, reason?: string) { return this.store.tasks.abort(id, reason); }
    pauseTask(id: string) { return this.store.tasks.pause(id); }
    resumeTask(id: string) { return this.store.tasks.resume(id); }
    heartbeatTask(id: string) { this.store.tasks.heartbeat(id); }
    findSimilarTask(title: string, goal: string) { return this.store.tasks.findSimilar(title, goal); }
    getTaskSummary(): string { return this.store.tasks.summary(); }
}
