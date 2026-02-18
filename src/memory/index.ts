/**
 * MemoryManager — thin facade over MemoryStore.
 * Maintains API compatibility with callers (agent, tools, prompt-builder).
 * @module memory/index
 */

import { resolve } from 'path';
import { MemoryStore } from './store';
import { RemoteMemoryStore } from './remote-store';
import { buildContext, searchKnowledge, buildFailureObservation } from './context';
import type { MemoryConfig, ContextResult, SearchResult, Entity, EntityType, Relation, RelationType, ActiveTask, TaskStatus } from './types';
import { SELF_ENTITY_NAME, RELATION_TYPES } from './types';

export { SELF_ENTITY_NAME, RELATION_TYPES };
export type { MemoryConfig, ContextResult, SearchResult, Entity, EntityType, Relation, RelationType, ActiveTask, TaskStatus };
export { buildFailureObservation };

interface RecentMsg { role: 'user' | 'assistant'; content: string; timestamp: Date }

export class MemoryManager {
    private store: MemoryStore | RemoteMemoryStore;
    private config: MemoryConfig;
    private remote: boolean;
    private sessionId = `session_${Date.now()}`;
    private recentMessages: RecentMsg[] = [];
    private pendingUser: string | null = null;
    private entityExtractor?: (prompt: string) => Promise<string>;

    constructor(config: MemoryConfig) {
        this.config = { recentWindowSize: 6, contextBudget: 4000, ...config };
        this.remote = !!config.mcpUrl;

        if (config.mcpUrl) {
            console.log(`🧠 Memory: remote mode → ${config.mcpUrl}`);
            this.store = new RemoteMemoryStore(config.mcpUrl);
        } else {
            this.store = new MemoryStore(
                resolve(config.storagePath, 'memory.json'),
                config.ownerName,
            );
        }
        this.entityExtractor = config.entityExtractor;
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
            this.extractEntitiesAsync(this.pendingUser, content);
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

        if (this.remote) {
            // Remote mode: build context from local recent window + MCP search
            const remote = this.store as RemoteMemoryStore;
            const recentStr = recent
                .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
                .join('\n');

            let graphContext = '';
            let relevantMemories = '';
            let retrievedCount = 0;
            let graphEntities = 0;

            try {
                const results = await remote.searchKnowledgeAsync(query, 10);
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

        return buildContext(query, this.store as MemoryStore, recent, this.sessionId, (this.config.contextBudget ?? 4000) * 4);
    }

    // ── Knowledge operations ─────────────────────────

    async saveKnowledge(fact: string, category?: string): Promise<void> {
        if (this.remote) {
            const remote = this.store as RemoteMemoryStore;
            await remote.callTool('save_knowledge', { fact, category });
            return;
        }
        const tagged = category ? `[${category}] ${fact}` : fact;
        const entities = this.store.searchEntities(fact, 1);
        if (entities.length > 0) {
            this.store.addEntity(entities[0].name, entities[0].type, [tagged]);
        } else {
            this.store.addEntity(category || 'knowledge', 'concept', [tagged]);
        }
    }

    async searchKnowledge(query: string, limit = 5): Promise<SearchResult[]> {
        if (this.remote) {
            return (this.store as RemoteMemoryStore).searchKnowledgeAsync(query, limit);
        }
        return searchKnowledge(this.store as MemoryStore, query, limit);
    }

    // ── Entity operations (for memory tools) ─────────

    addEntity(name: string, type: EntityType, facts: string[]): Entity {
        return this.store.addEntity(name, type, facts);
    }
    getEntity(name: string) { return this.store.getEntity(name); }
    getAllEntities() { return this.store.getAllEntities(); }
    getAllRelations() { return this.store.getAllRelations(); }
    addRelation(from: string, type: RelationType, to: string) { return this.store.addRelation(from, type, to); }

    // ── Self-identity ────────────────────────────────

    getSelfContext(): string {
        const self = this.store.getSelfEntity();
        if (self.facts.length <= 2) return ''; // only seed facts
        return self.facts.map(f => `• ${f}`).join('\n');
    }

    recordSelfObservation(content: string, _category?: string): void { this.store.addSelfObservation(content); }

    updateEntitySession(
        entityName: string,
        _exchanges: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>,
        _channel?: string,
    ): void {
        const entity = this.store.getEntity(entityName);
        if (entity) { entity.lastSeen = Date.now(); entity.accessCount++; }
        else { this.store.addEntity(entityName, 'person', [`Active conversation partner`]); }
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

    getStore(): MemoryStore | RemoteMemoryStore { return this.store; }

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

    // ── Async entity extraction (non-blocking) ───────

    private extractEntitiesAsync(user: string, assistant: string): void {
        if (!this.entityExtractor) return;
        const prompt = `Extract entities from this exchange. Return JSON: {"entities":[{"name":"...","type":"person|project|technology|preference|concept","facts":["..."]}]}
User: ${user.slice(0, 500)}
Assistant: ${assistant.slice(0, 500)}`;

        this.entityExtractor(prompt).then(raw => {
            try {
                const { entities } = JSON.parse(raw);
                for (const e of entities) {
                    if (e.name && e.type && Array.isArray(e.facts)) {
                        this.store.addEntity(e.name, e.type, e.facts);
                    }
                }
            } catch { /* extraction failed — non-critical */ }
        }).catch(() => { /* non-critical */ });
    }
}
