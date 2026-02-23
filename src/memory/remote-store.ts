/**
 * Remote Memory Store — delegates all reads/writes to the Memory MCP Server.
 *
 * Drop-in replacement for the local MemoryStore. The MCP server becomes the
 * single source of truth for memory.json — no more dual-writer conflicts.
 *
 * Uses plain HTTP + JSON-RPC to call MCP tools (stateless mode).
 */

import type { Entity, EntityType, Fact, Relation, RelationType, Exchange, SearchResult } from './types';

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
    private _healthy = true;
    private static readonly RETRY_ATTEMPTS = 2;
    private static readonly RETRY_DELAY_MS = 500;
    readonly tasks: RemoteTaskManager;

    constructor(mcpUrl: string) {
        this.mcpUrl = mcpUrl;
        // Tasks go through MCP tools — proxy object
        this.tasks = this.createTaskProxy();
    }

    // ── MCP RPC helper ───────────────────────────────

    async callTool(name: string, args: Record<string, any> = {}): Promise<string> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= RemoteMemoryStore.RETRY_ATTEMPTS; attempt++) {
            try {
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
                    signal: AbortSignal.timeout(10_000),
                });
                const text = await res.text();
                // SSE format: "event: message\ndata: {json}\n\n"
                const match = text.match(/^data: (.+)$/m);
                if (!match) throw new Error(`MCP call failed for ${name}: ${text.slice(0, 200)}`);
                const parsed = JSON.parse(match[1]);
                if (parsed.error) throw new Error(parsed.error.message);
                const content = parsed.result?.content;
                this._healthy = true;
                if (Array.isArray(content) && content.length > 0) return content[0].text ?? '';
                return '';
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < RemoteMemoryStore.RETRY_ATTEMPTS) {
                    const delay = RemoteMemoryStore.RETRY_DELAY_MS * (attempt + 1);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }

        this._healthy = false;
        console.error(`[Memory]: MCP call '${name}' failed after ${RemoteMemoryStore.RETRY_ATTEMPTS + 1} attempts: ${lastError?.message}`);
        throw lastError!;
    }

    async callToolJson<T>(name: string, args: Record<string, any> = {}): Promise<T> {
        const text = await this.callTool(name, args);
        return JSON.parse(text) as T;
    }

    // ── Lifecycle ────────────────────────────────────

    async init(): Promise<void> {
        // Verify connection + cache stats (non-fatal — agent works without memory)
        try {
            await this.refreshStats();
            console.log(`🧠 Remote memory: ${this._entityCount} entities, ${this._relationCount} relations, ${this._exchangeCount} exchanges`);
        } catch (err) {
            this._healthy = false;
            console.warn(`⚠️  Memory MCP unreachable — agent will run without persistent memory. Reason: ${err instanceof Error ? err.message : err}`);
        }
    }

    async flush(): Promise<void> { /* no-op — MCP server manages its own persistence */ }

    async clear(): Promise<void> {
        console.warn('[Memory] clear_all tool has been removed from MCP server — memory clear is a no-op');
    }

    /** Whether the MCP server is reachable */
    get isHealthy(): boolean { return this._healthy; }

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

    addEntity(name: string, type: EntityType, facts: string[], tags?: Record<string, string>): Entity {
        // Fire-and-forget for sync interface compatibility
        this.callTool('add_entity', { name, type, facts, ...(tags ? { tags } : {}) }).catch(err =>
            console.warn(`[Memory]: addEntity(${name}) failed: ${err instanceof Error ? err.message : err}`),
        );
        const now = Date.now();
        const structuredFacts: Fact[] = facts.map(f => ({ content: f, confidence: 1.0, sources: 1, firstSeen: now, lastConfirmed: now }));
        return { name, type, facts: structuredFacts, lastSeen: now, accessCount: 1, ...(tags ? { tags } : {}) };
    }

    getEntity(_name: string): Entity | undefined {
        // Sync method — can't await. Return undefined (caller should use async version).
        // For the agent's entity extraction this is fine — it only checks existence.
        return undefined;
    }

    async getEntityAsync(name: string, query?: string, limit?: number): Promise<Entity | undefined> {
        try {
            const args: Record<string, any> = { name };
            if (query) args.query = query;
            if (limit) args.limit = limit;
            const text = await this.callTool('get_entity', args);
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
        this.callTool('add_relation', { from, type, to }).catch(err =>
            console.warn(`[Memory]: addRelation(${from} → ${to}) failed: ${err instanceof Error ? err.message : err}`),
        );
        const now = Date.now();
        return { from, to, type, weight: 0.5, evidenceCount: 1, lastValidated: now, createdAt: now };
    }

    getAllRelations(): Relation[] { return []; }

    async getAllRelationsAsync(): Promise<Relation[]> {
        return this.callToolJson<Relation[]>('get_all_relations');
    }

    // ── Exchanges ────────────────────────────────────

    addExchange(user: string, assistant: string, sessionId: string, tags?: Record<string, string>): void {
        this.callTool('add_exchange', { user, assistant, sessionId, ...(tags ? { project: tags.project } : {}) }).catch(err =>
            console.warn(`[Memory]: addExchange failed: ${err instanceof Error ? err.message : err}`),
        );
    }

    getExchanges(): Exchange[] { return []; }

    /** Fetch recent exchanges from MCP for conversation restoration */
    async getRecentExchangesAsync(limit = 20): Promise<Array<{ user: string; assistant: string; timestamp?: number }>> {
        try {
            const text = await this.callTool('search_exchanges', { query: '*', limit });
            if (text.includes('No ') || !text.trim()) return [];
            // Try JSON parse first (Rust server returns JSON)
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return parsed;
            } catch {
                // TS server returns formatted text — parse it
            }
            // Fallback: parse "User: ... | Assistant: ..." text format
            const exchanges: Array<{ user: string; assistant: string; timestamp?: number }> = [];
            const lines = text.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const m = line.match(/User:\s*(.+?)\s*(?:\||\u2192|\u2192)\s*Assistant:\s*(.+)/i);
                if (m) exchanges.push({ user: m[1].trim(), assistant: m[2].trim() });
            }
            return exchanges;
        } catch { return []; }
    }

    // ── Search ───────────────────────────────────────

    searchEntities(_query: string, _limit = 5): Entity[] {
        // Sync — can't call MCP. Return empty. searchKnowledge covers this.
        return [];
    }

    async searchEntitiesAsync(query: string, limit = 5, project?: string): Promise<Entity[]> {
        const text = await this.callTool('search_entities', { query, limit, ...(project ? { project } : {}) });
        if (text.includes('No matching')) return [];
        // Parse bullet list: "• Name (type): facts"
        const entities: Entity[] = [];
        for (const line of text.split('\n')) {
            const m = line.match(/^[•\-]\s*(.+?)\s*\((\w[\w-]*)\):\s*(.+)/);
            if (m) {
                // Parse facts — may include confidence like "fact text [80%]"
                const factStrs = m[3].split('; ');
                const facts: Fact[] = factStrs.map(fs => {
                    const cm = fs.match(/^(.+?)\s*\[(\d+)%\]$/);
                    const content = cm ? cm[1].trim() : fs.trim();
                    const confidence = cm ? parseInt(cm[2]) / 100 : 0.5;
                    return { content, confidence, sources: 1, firstSeen: 0, lastConfirmed: 0 };
                });
                entities.push({ name: m[1], type: m[2] as EntityType, facts, lastSeen: 0, accessCount: 0 });
            }
        }
        return entities;
    }

    searchExchanges(_query: string, _limit = 5): Exchange[] {
        return [];
    }

    async searchExchangesAsync(query: string, limit = 5, project?: string): Promise<Exchange[]> {
        return this.callToolJson<Exchange[]>('search_exchanges', { query, limit, ...(project ? { project } : {}) });
    }

    searchKnowledge(_query: string, _limit = 5): SearchResult[] {
        return [];
    }

    async searchKnowledgeAsync(query: string, limit = 5, project?: string): Promise<SearchResult[]> {
        const text = await this.callTool('search_knowledge', { query, limit, ...(project ? { project } : {}) });
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

    async getSelfEntityAsync(query?: string, limit?: number): Promise<Entity> {
        const args: Record<string, any> = {};
        if (query) args.query = query;
        if (limit) args.limit = limit;
        // When query is provided, MCP returns text format — parse facts from bullet lines
        if (query || limit) {
            const text = await this.callTool('get_self_entity', args);
            const facts: Fact[] = [];
            for (const line of text.split('\n')) {
                const m = line.match(/^\u2022\s*\[(\d+)%\]\s*(.+)/);
                if (m) {
                    facts.push({
                        content: m[2].trim(),
                        confidence: parseInt(m[1]) / 100,
                        sources: 1,
                        firstSeen: 0,
                        lastConfirmed: 0,
                    });
                }
            }
            return { name: 'Forkscout Agent', type: 'agent-self', facts, lastSeen: Date.now(), accessCount: 0 };
        }
        return this.callToolJson<Entity>('get_self_entity', args);
    }

    addSelfObservation(content: string): void {
        this.callTool('self_observe', { content }).catch(err =>
            console.warn(`[Memory]: selfObserve failed: ${err instanceof Error ? err.message : err}`),
        );
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
                callTool('start_task', { title, goal, successCondition: opts?.successCondition }).catch(err =>
                    console.warn(`[Memory]: startTask(${title}) failed: ${err instanceof Error ? err.message : err}`),
                );
                return { id, title, goal, status: 'running', startedAt: Date.now(), lastStepAt: Date.now(), ...opts };
            },
            get(_id: string) { return undefined; },
            complete(id: string, reason?: string) {
                callTool('complete_task', { taskId: id, result: reason }).catch(err =>
                    console.warn(`[Memory]: completeTask(${id}) failed: ${err instanceof Error ? err.message : err}`),
                );
                return { id, status: 'completed' };
            },
            abort(id: string, reason?: string) {
                callTool('abort_task', { taskId: id, reason: reason || 'Aborted' }).catch(err =>
                    console.warn(`[Memory]: abortTask(${id}) failed: ${err instanceof Error ? err.message : err}`),
                );
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
