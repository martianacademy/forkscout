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

interface RecentMsg { role: 'user' | 'assistant'; content: string; timestamp: Date }

export class MemoryManager {
    private store: RemoteMemoryStore;
    private config: MemoryConfig;
    private sessionId = `session_${Date.now()}`;
    private recentMessages: RecentMsg[] = [];
    private pendingUser: string | null = null;

    constructor(config: MemoryConfig) {
        this.config = { recentWindowSize: 6, contextBudget: 4000, ...config };

        if (!config.mcpUrl) {
            throw new Error('MemoryManager requires mcpUrl — set agent.forkscoutMemoryMcpUrl in config or MEMORY_MCP_URL env');
        }

        console.log(`🧠 Memory: remote mode → ${config.mcpUrl}`);
        this.store = new RemoteMemoryStore(config.mcpUrl);
    }

    // ── Lifecycle ────────────────────────────────────

    async init(): Promise<void> { await this.store.init(); }

    async flush(): Promise<void> {
        if (this.pendingUser) {
            this.store.addExchange(this.pendingUser, '', this.sessionId);
            this.pendingUser = null;
        }
        await this.store.flush();
    }

    async clear(): Promise<void> {
        this.recentMessages = [];
        this.pendingUser = null;
        await this.store.clear();
    }

    // ── Message handling ─────────────────────────────

    addMessage(role: 'user' | 'assistant', content: string): void {
        this.recentMessages.push({ role, content, timestamp: new Date() });
        if (role === 'user') {
            this.pendingUser = content;
        } else if (role === 'assistant' && this.pendingUser) {
            this.store.addExchange(this.pendingUser, content, this.sessionId);
            this.pendingUser = null;
        }
    }

    getRecentHistory(limit?: number): Array<{ role: 'user' | 'assistant'; content: string }> {
        const n = limit ?? this.config.recentWindowSize ?? 6;
        return this.recentMessages.slice(-n).map(({ role, content }) => ({ role, content }));
    }

    getRecentHistoryWithTimestamps(limit?: number): RecentMsg[] {
        const n = limit ?? this.config.recentWindowSize ?? 6;
        return this.recentMessages.slice(-n);
    }

    // ── Context building ─────────────────────────────

    async buildContext(query: string): Promise<ContextResult> {
        const windowSize = this.config.recentWindowSize ?? 6;
        const recent = this.recentMessages.slice(-windowSize);
        const recentStr = recent
            .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
            .join('\n');

        let graphContext = '';
        let relevantMemories = '';
        let retrievedCount = 0;
        let graphEntities = 0;

        try {
            const results = await this.store.searchKnowledgeAsync(query, 10);
            const graphLines: string[] = [];
            const exchangeLines: string[] = [];
            for (const r of results) {
                if (r.source === 'graph') { graphLines.push(`• ${r.content}`); graphEntities++; }
                else { exchangeLines.push(`[Past] ${r.content}`); retrievedCount++; }
            }
            if (graphLines.length) graphContext = '\n\n[Knowledge Graph]\n' + graphLines.join('\n');
            if (exchangeLines.length) relevantMemories = '\n\nRelevant memories from past conversations:\n' + exchangeLines.join('\n\n');
        } catch { /* MCP unreachable — use local recent only */ }

        return {
            recentHistory: recentStr,
            relevantMemories,
            graphContext,
            skillContext: '',
            stats: { recentCount: recent.length, retrievedCount, graphEntities, totalChunks: 0, skillCount: 0, situation: { primary: [], goal: '' } },
        };
    }

    // ── Knowledge operations ─────────────────────────

    async saveKnowledge(fact: string, category?: string): Promise<void> {
        await this.store.callTool('save_knowledge', { fact, category });
    }

    async searchKnowledge(query: string, limit = 5): Promise<SearchResult[]> {
        return this.store.searchKnowledgeAsync(query, limit);
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
        // Remote mode — sync access not available. MCP tools handle self-entity.
        return '';
    }

    recordSelfObservation(content: string, _category?: string): void { this.store.addSelfObservation(content); }

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
