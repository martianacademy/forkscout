/**
 * Budget Tracker — cost control for multi-model LLM usage.
 *
 * Tracks spending per model, per day, per month.
 * Enforces hard limits that downgrade model tiers when exceeded.
 * Persists to disk so budgets survive restarts.
 *
 * Configuration via env vars:
 *   BUDGET_DAILY_USD    — daily hard limit (default: 5.00)
 *   BUDGET_MONTHLY_USD  — monthly hard limit (default: 50.00)
 *   BUDGET_WARNING_PCT  — warning threshold as % (default: 80)
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

export interface BudgetData {
    /** All spending records for the current billing period */
    records: SpendRecord[];
    /** When the records were last pruned (ISO date) */
    lastPruned: string;
}

export interface BudgetLimits {
    dailyUSD: number;
    monthlyUSD: number;
    warningPct: number;
}

export interface BudgetStatus {
    todayUSD: number;
    monthUSD: number;
    dailyLimitUSD: number;
    monthlyLimitUSD: number;
    dailyPct: number;
    monthlyPct: number;
    isWarning: boolean;
    isDailyExceeded: boolean;
    isMonthlyExceeded: boolean;
    /** If budget forces a tier downgrade, which tier we're capped at */
    cappedTier: ModelTier | null;
    todayByModel: Record<string, { cost: number; inputTokens: number; outputTokens: number; calls: number }>;
}

// ── Budget Tracker ─────────────────────────────────────

export class BudgetTracker {
    private limits: BudgetLimits;
    private data: BudgetData;
    private persistPath: string;
    private dirty = false;
    private flushTimer: ReturnType<typeof setInterval> | null = null;

    constructor(limits: BudgetLimits, persistPath: string) {
        this.limits = limits;
        this.persistPath = persistPath;
        this.data = this.load();

        // Auto-flush every 60 seconds if dirty
        this.flushTimer = setInterval(() => {
            if (this.dirty) this.save();
        }, 60_000);
    }

    /** Create from env vars with sensible defaults */
    static fromEnv(storagePath?: string): BudgetTracker {
        const limits: BudgetLimits = {
            dailyUSD: parseFloat(process.env.BUDGET_DAILY_USD || '5'),
            monthlyUSD: parseFloat(process.env.BUDGET_MONTHLY_USD || '50'),
            warningPct: parseFloat(process.env.BUDGET_WARNING_PCT || '80'),
        };

        const dir = storagePath || resolve(process.cwd(), '.forkscout');
        const path = resolve(dir, 'budget.json');
        return new BudgetTracker(limits, path);
    }

    /** Create from config object */
    static fromConfig(budget: { dailyUSD: number; monthlyUSD: number; warningPct: number }, storagePath?: string): BudgetTracker {
        const dir = storagePath || resolve(process.cwd(), '.forkscout');
        const path = resolve(dir, 'budget.json');
        return new BudgetTracker(budget, path);
    }

    /** Record a spend event */
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

        // Log significant costs
        if (cost > 0.01) {
            const status = this.getStatus();
            console.log(`[Budget]: $${cost.toFixed(4)} (${modelId}) | Today: $${status.todayUSD.toFixed(2)}/$${status.dailyLimitUSD} | Month: $${status.monthUSD.toFixed(2)}/$${status.monthlyLimitUSD}`);
        }

        // Warning check
        const status = this.getStatus();
        if (status.isWarning && !status.isDailyExceeded && !status.isMonthlyExceeded) {
            console.warn(`[Budget]: ⚠️  Approaching limit — daily ${status.dailyPct.toFixed(0)}%, monthly ${status.monthlyPct.toFixed(0)}%`);
        }
        if (status.isDailyExceeded) {
            console.warn(`[Budget]: 🛑 Daily limit exceeded ($${status.todayUSD.toFixed(2)}/$${status.dailyLimitUSD})! Downgrading to cheaper models.`);
        }
        if (status.isMonthlyExceeded) {
            console.warn(`[Budget]: 🛑 Monthly limit exceeded ($${status.monthUSD.toFixed(2)}/$${status.monthlyLimitUSD})! Downgrading to cheapest model.`);
        }
    }

    /** Given a desired tier, downgrade if budget is exceeded */
    adjustTier(desired: ModelTier): ModelTier {
        const status = this.getStatus();

        // Monthly exceeded → force fast only
        if (status.isMonthlyExceeded) return 'fast';

        // Daily exceeded → cap at balanced (no powerful)
        if (status.isDailyExceeded) {
            if (desired === 'powerful') return 'balanced';
            return desired;
        }

        // Warning zone (>80% daily) → cap powerful→balanced
        if (status.dailyPct > this.limits.warningPct && desired === 'powerful') {
            return 'balanced';
        }

        return desired;
    }

    /** Get current budget status */
    getStatus(): BudgetStatus {
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

        const dailyPct = this.limits.dailyUSD > 0 ? (todayUSD / this.limits.dailyUSD) * 100 : 0;
        const monthlyPct = this.limits.monthlyUSD > 0 ? (monthUSD / this.limits.monthlyUSD) * 100 : 0;

        const isDailyExceeded = todayUSD >= this.limits.dailyUSD;
        const isMonthlyExceeded = monthUSD >= this.limits.monthlyUSD;
        const isWarning = dailyPct >= this.limits.warningPct || monthlyPct >= this.limits.warningPct;

        let cappedTier: ModelTier | null = null;
        if (isMonthlyExceeded) cappedTier = 'fast';
        else if (isDailyExceeded) cappedTier = 'balanced';

        return {
            todayUSD,
            monthUSD,
            dailyLimitUSD: this.limits.dailyUSD,
            monthlyLimitUSD: this.limits.monthlyUSD,
            dailyPct,
            monthlyPct,
            isWarning,
            isDailyExceeded,
            isMonthlyExceeded,
            cappedTier,
            todayByModel,
        };
    }

    /** Update limits at runtime */
    setLimits(patch: Partial<BudgetLimits>): BudgetLimits {
        Object.assign(this.limits, patch);
        return { ...this.limits };
    }

    /** Get current limits */
    getLimits(): BudgetLimits {
        return { ...this.limits };
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
            console.error(`[Budget]: Failed to save: ${err instanceof Error ? err.message : String(err)}`);
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

    private load(): BudgetData {
        try {
            if (existsSync(this.persistPath)) {
                const raw = readFileSync(this.persistPath, 'utf-8');
                const data = JSON.parse(raw) as BudgetData;
                // Validate structure
                if (Array.isArray(data.records)) {
                    this.pruneOldRecords(data);
                    return data;
                }
            }
        } catch (err) {
            console.warn(`[Budget]: Failed to load budget data, starting fresh: ${err instanceof Error ? err.message : String(err)}`);
        }
        return { records: [], lastPruned: this.toDateStr(new Date()) };
    }

    /** Remove records older than 35 days (keep current month + a few days buffer) */
    private pruneOldRecords(data?: BudgetData): void {
        const d = data || this.data;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 35);
        const cutoffStr = this.toDateStr(cutoff);

        const before = d.records.length;
        d.records = d.records.filter(r => r.date >= cutoffStr);
        d.lastPruned = this.toDateStr(new Date());

        if (before !== d.records.length) {
            console.log(`[Budget]: Pruned ${before - d.records.length} old records`);
        }
    }

    private toDateStr(d: Date): string {
        return d.toISOString().slice(0, 10);
    }
}
