/**
 * Usage Tracker — analytics-only cost & token tracking for multi-model LLM usage.
 *
 * Tracks spending per model, per day, per month — purely for observability.
 * No enforcement, no limits, no tier downgrades.
 * Persists to disk so analytics survive restarts.
 *
 * @module llm/usage-tracker
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import type { ModelTier } from './router';

// ── Types ──────────────────────────────────────────────

export interface SpendRecord {
    /** ISO date string (YYYY-MM-DD) */
    date: string;
    /** Model ID */
    modelId: string;
    /** Cost in USD */
    cost: number;
    /** Input tokens */
    inputTokens: number;
    /** Output tokens */
    outputTokens: number;
    /** Timestamp */
    timestamp: number;
}

interface UsageData {
    /** All spending records for the current billing period */
    records: SpendRecord[];
    /** When the records were last pruned (ISO date) */
    lastPruned: string;
}

export interface UsageStatus {
    todayUSD: number;
    monthUSD: number;
    todayByModel: Record<string, { cost: number; inputTokens: number; outputTokens: number; calls: number }>;
}

// ── Usage Tracker ──────────────────────────────────────

export class UsageTracker {
    private data: UsageData;
    private persistPath: string;
    private dirty = false;
    private flushTimer: ReturnType<typeof setInterval> | null = null;

    constructor(persistPath: string) {
        this.persistPath = persistPath;
        this.data = this.load();

        // Auto-flush every 60 seconds if dirty
        this.flushTimer = setInterval(() => {
            if (this.dirty) this.save();
        }, 60_000);
    }

    /** Create with default storage path */
    static create(storagePath?: string): UsageTracker {
        const dir = storagePath || resolve(process.cwd(), '.forkscout');
        const path = resolve(dir, 'usage.json');
        return new UsageTracker(path);
    }

    /** Record a spend event (analytics only — no enforcement) */
    recordSpend(cost: number, modelId: string, inputTokens: number, outputTokens: number): void {
        if (cost <= 0) return;

        const now = new Date();
        this.data.records.push({
            date: this.toDateStr(now),
            modelId,
            cost,
            inputTokens,
            outputTokens,
            timestamp: now.getTime(),
        });
        this.dirty = true;

        // Log significant costs for observability
        if (cost > 0.01) {
            const status = this.getStatus();
            console.log(`[Usage]: $${cost.toFixed(4)} (${modelId}) | Today: $${status.todayUSD.toFixed(2)} | Month: $${status.monthUSD.toFixed(2)}`);
        }
    }

    /** Pass-through — no tier adjustment (analytics only) */
    adjustTier(desired: ModelTier): ModelTier {
        return desired;
    }

    /** Get current usage analytics */
    getStatus(): UsageStatus {
        const today = this.toDateStr(new Date());
        const monthPrefix = today.slice(0, 7); // YYYY-MM

        let todayUSD = 0;
        let monthUSD = 0;
        const todayByModel: Record<string, { cost: number; inputTokens: number; outputTokens: number; calls: number }> = {};

        for (const r of this.data.records) {
            // Month total
            if (r.date.startsWith(monthPrefix)) {
                monthUSD += r.cost;
            }
            // Today total + per-model breakdown
            if (r.date === today) {
                todayUSD += r.cost;
                if (!todayByModel[r.modelId]) {
                    todayByModel[r.modelId] = { cost: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
                }
                todayByModel[r.modelId].cost += r.cost;
                todayByModel[r.modelId].inputTokens += r.inputTokens;
                todayByModel[r.modelId].outputTokens += r.outputTokens;
                todayByModel[r.modelId].calls += 1;
            }
        }

        return { todayUSD, monthUSD, todayByModel };
    }

    /** Flush to disk */
    save(): void {
        try {
            this.pruneOldRecords();
            const dir = dirname(this.persistPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(this.persistPath, JSON.stringify(this.data, null, 2));
            this.dirty = false;
        } catch (err) {
            console.error(`[Usage]: Failed to save: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** Stop auto-flush timer */
    stop(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.dirty) this.save();
    }

    // ── Internal ───────────────────────────────────────

    private load(): UsageData {
        try {
            if (existsSync(this.persistPath)) {
                const raw = readFileSync(this.persistPath, 'utf-8');
                const data = JSON.parse(raw) as UsageData;
                if (Array.isArray(data.records)) {
                    this.pruneOldRecords(data);
                    return data;
                }
            }
        } catch (err) {
            console.warn(`[Usage]: Failed to load usage data, starting fresh: ${err instanceof Error ? err.message : String(err)}`);
        }
        return { records: [], lastPruned: this.toDateStr(new Date()) };
    }

    /** Remove records older than 35 days */
    private pruneOldRecords(data?: UsageData): void {
        const d = data || this.data;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 35);
        const cutoffStr = this.toDateStr(cutoff);

        const before = d.records.length;
        d.records = d.records.filter(r => r.date >= cutoffStr);
        d.lastPruned = this.toDateStr(new Date());

        if (before !== d.records.length) {
            console.log(`[Usage]: Pruned ${before - d.records.length} old records`);
        }
    }

    private toDateStr(d: Date): string {
        return d.toISOString().slice(0, 10);
    }
}
