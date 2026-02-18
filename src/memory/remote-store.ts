/**
 * Remote Memory Store — delegates all reads/writes to the Memory MCP Server.
 *
 * Drop-in replacement for the local MemoryStore. The MCP server becomes the
 * single source of truth for memory.json — no more dual-writer conflicts.
 *
 * Uses plain HTTP + JSON-RPC to call MCP tools (stateless mode).
 */

import type { Entity, EntityType, Relation, RelationType, Exchange, SearchResult } from './types';

// Minimal task manager interface (matches what MemoryManager expects)
export interface RemoteTaskManager {
    create(title: string, goal: string, opts?: { budgetRemaining?: number; successCondition?: string }): any;
    get(id: string): any;
    complete(id: string, reason?: string): any;
    abort(id: string, reason?: string): any;
    pause(id: string): any;
    resume(id: string): any;
    heartbeat(id: string): void;
    findSimilar(title: string, goal: string): any;
    summary(): string;
    getByStatus(status: string): any[];
    getAll(): any[];
    get runningCount(): number;
    get totalCount(): number;
}

export class RemoteMemoryStore {
    private mcpUrl: string;
    private requestId = 0;
    private _entityCount = 0;
    private _relationCount = 0;
    private _exchangeCount = 0;
    readonly tasks: RemoteTaskManager;

    constructor(mcpUrl: string) {
        this.mcpUrl = mcpUrl;
        // Tasks go through MCP tools — proxy object
        this.tasks = this.createTaskProxy();
    }

    // ── MCP RPC helper ───────────────────────────────

    async callTool(name: string, args: Record<string, any> = {}): Promise<string> {
        const res = await fetch(this.mcpUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: ++this.requestId,
                method: 'tools/call',
                params: { name, arguments: args },
            }),
        });
        const text = await res.text();
        // SSE format: "event: message\ndata: {json}\n\n"
        const match = text.match(/^data: (.+)$/m);
        if (!match) throw new Error(`MCP call failed for ${name}: ${text.slice(0, 200)}`);
        const parsed = JSON.parse(match[1]);
        if (parsed.error) throw new Error(parsed.error.message);
        const content = parsed.result?.content;
        if (Array.isArray(content) && content.length > 0) return content[0].text ?? '';
        return '';
    }

    async callToolJson<T>(name: string, args: Record<string, any> = {}): Promise<T> {
        const text = await this.callTool(name, args);
        return JSON.parse(text) as T;
    }

    // ── Lifecycle ────────────────────────────────────

    async init(): Promise<void> {
        // Verify connection + cache stats
        await this.refreshStats();
        console.log(`🧠 Remote memory: ${this._entityCount} entities, ${this._relationCount} relations, ${this._exchangeCount} exchanges`);
    }

    async flush(): Promise<void> { /* no-op — MCP server manages its own persistence */ }

    async clear(): Promise<void> {
        await this.callTool('clear_all', { reason: 'Agent requested clear' });
    }

    private async refreshStats(): Promise<void> {
        const text = await this.callTool('memory_stats');
        const m1 = text.match(/Entities:\s*(\d+)/);
        const m2 = text.match(/Relations:\s*(\d+)/);
        const m3 = text.match(/Exchanges:\s*(\d+)/);
        this._entityCount = m1 ? parseInt(m1[1]) : 0;
        this._relationCount = m2 ? parseInt(m2[1]) : 0;
        this._exchangeCount = m3 ? parseInt(m3[1]) : 0;
    }

    // ── Entity CRUD ──────────────────────────────────

    addEntity(name: string, type: EntityType, facts: string[]): Entity {
        // Fire-and-forget for sync interface compatibility
        this.callTool('add_entity', { name, type, facts }).catch(() => { });
        return { name, type, facts, lastSeen: Date.now(), accessCount: 1 };
    }

    getEntity(_name: string): Entity | undefined {
        // Sync method — can't await. Return undefined (caller should use async version).
        // For the agent's entity extraction this is fine — it only checks existence.
        return undefined;
    }

    async getEntityAsync(name: string): Promise<Entity | undefined> {
        try {
            const text = await this.callTool('get_entity', { name });
            if (text.includes('not found')) return undefined;
            // Parse the text response back to entity
            return JSON.parse(text);
        } catch { return undefined; }
    }

    getAllEntities(): Entity[] {
        // Sync method — return empty. Use async version for real data.
        return [];
    }

    async getAllEntitiesAsync(): Promise<Entity[]> {
        return this.callToolJson<Entity[]>('get_all_entities', {});
    }

    // ── Relations ────────────────────────────────────

    addRelation(from: string, type: RelationType, to: string): Relation {
        this.callTool('add_relation', { from, type, to }).catch(() => { });
        return { from, to, type, createdAt: Date.now() };
    }

    getAllRelations(): Relation[] { return []; }

    async getAllRelationsAsync(): Promise<Relation[]> {
        return this.callToolJson<Relation[]>('get_all_relations');
    }

    // ── Exchanges ────────────────────────────────────

    addExchange(user: string, assistant: string, sessionId: string): void {
        this.callTool('add_exchange', { user, assistant, sessionId }).catch(() => { });
    }

    getExchanges(): Exchange[] { return []; }

    // ── Search ───────────────────────────────────────

    searchEntities(_query: string, _limit = 5): Entity[] {
        // Sync — can't call MCP. Return empty. searchKnowledge covers this.
        return [];
    }

    async searchEntitiesAsync(query: string, limit = 5): Promise<Entity[]> {
        const text = await this.callTool('search_entities', { query, limit });
        if (text.includes('No matching')) return [];
        // Parse bullet list: "• Name (type): facts"
        const entities: Entity[] = [];
        for (const line of text.split('\n')) {
            const m = line.match(/^[•\-]\s*(.+?)\s*\((\w[\w-]*)\):\s*(.+)/);
            if (m) entities.push({ name: m[1], type: m[2] as EntityType, facts: m[3].split('; '), lastSeen: 0, accessCount: 0 });
        }
        return entities;
    }

    searchExchanges(_query: string, _limit = 5): Exchange[] {
        return [];
    }

    async searchExchangesAsync(query: string, limit = 5): Promise<Exchange[]> {
        return this.callToolJson<Exchange[]>('search_exchanges', { query, limit });
    }

    searchKnowledge(_query: string, _limit = 5): SearchResult[] {
        return [];
    }

    async searchKnowledgeAsync(query: string, limit = 5): Promise<SearchResult[]> {
        const text = await this.callTool('search_knowledge', { query, limit });
        if (text.includes('No relevant')) return [];
        const results: SearchResult[] = [];
        for (const line of text.split('\n')) {
            const m = line.match(/^\d+\.\s*\[(\d+)%,\s*(\w+)\]\s*(.+)/);
            if (m) results.push({ content: m[3], source: m[2] as 'graph' | 'exchange', relevance: parseInt(m[1]) });
        }
        return results;
    }

    // ── Self-entity ──────────────────────────────────

    getSelfEntity(): Entity {
        // Can't await in sync context — return stub. Async version exists.
        return { name: 'Forkscout Agent', type: 'agent-self', facts: [], lastSeen: 0, accessCount: 0 };
    }

    async getSelfEntityAsync(): Promise<Entity> {
        return this.callToolJson<Entity>('get_self_entity');
    }

    addSelfObservation(content: string): void {
        this.callTool('self_observe', { content }).catch(() => { });
    }

    // ── Stats ────────────────────────────────────────

    get entityCount(): number { return this._entityCount; }
    get relationCount(): number { return this._relationCount; }
    get exchangeCount(): number { return this._exchangeCount; }

    // ── Task proxy ───────────────────────────────────

    private createTaskProxy(): RemoteTaskManager {
        const callTool = this.callTool.bind(this);

        return {
            create(title: string, goal: string, opts?: any) {
                const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                callTool('start_task', { title, goal, successCondition: opts?.successCondition }).catch(() => { });
                return { id, title, goal, status: 'running', startedAt: Date.now(), lastStepAt: Date.now(), ...opts };
            },
            get(_id: string) { return undefined; },
            complete(id: string, reason?: string) {
                callTool('complete_task', { taskId: id, result: reason }).catch(() => { });
                return { id, status: 'completed' };
            },
            abort(id: string, reason?: string) {
                callTool('abort_task', { taskId: id, reason: reason || 'Aborted' }).catch(() => { });
                return { id, status: 'aborted' };
            },
            pause(_id: string) { return undefined; },
            resume(_id: string) { return undefined; },
            heartbeat(_id: string) { },
            findSimilar(_title: string, _goal: string) { return undefined; },
            summary() { return ''; },
            getByStatus(_status: string) { return []; },
            getAll() { return []; },
            get runningCount() { return 0; },
            get totalCount() { return 0; },
        };
    }
}
