/**
 * Skill Store — procedural memory layer.
 *
 * Stores learned workflows/sequences that the agent has performed successfully.
 * This is the difference between "knowing facts" and "knowing how to do things."
 *
 * Skills are NEVER written directly by the LLM — they are derived by the
 * consolidator from repeated successful episode patterns.
 *
 * Example:
 *   After the agent successfully deploys 3 times, a skill is synthesized:
 *   {
 *     name: "Deploy to production",
 *     intent: "user asks to deploy or push to prod",
 *     steps: ["run tests", "build", "push to main", "verify deployment"],
 *     successRate: 1.0,
 *     evidenceCount: 3
 *   }
 *
 * Persistence: separate JSON file (skills.json) — different access pattern from graph.
 */

// ── Types ──────────────────────────────────────────────

export interface Skill {
    /** Unique identifier (content-hash based) */
    id: string;
    /** Human-readable skill name */
    name: string;
    /** When to use this skill — natural language trigger description */
    intent: string;
    /** Ordered sequence of symbolic actions */
    steps: string[];
    /** Success rate (0-1), updated on each use */
    successRate: number;
    /** When this skill was last successfully used */
    lastUsed: number;
    /** How many episodes support this skill */
    evidenceCount: number;
    /** Episode/chunk IDs this skill was derived from */
    derivedFrom: string[];
    /** When this skill was first synthesized */
    createdAt: number;
    /** When this skill was last updated */
    updatedAt: number;
}

export interface SkillData {
    skills: Skill[];
    version: number;
}

// ── Skill Store ───────────────────────────────────────

const SKILL_SCHEMA_VERSION = 1;

export class SkillStore {
    private skills = new Map<string, Skill>();
    private filePath: string;
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    async init(): Promise<void> {
        try {
            const fs = await import('fs/promises');
            const raw = await fs.readFile(this.filePath, 'utf-8');
            const data: SkillData = JSON.parse(raw);
            for (const skill of data.skills) {
                this.skills.set(skill.id, skill);
            }
        } catch {
            // No existing skills — start fresh
        }
        if (this.skills.size > 0) {
            console.log(`⚡ Procedural memory: ${this.skills.size} learned skills`);
        }
    }

    async flush(): Promise<void> {
        if (!this.dirty) return;
        try {
            const fs = await import('fs/promises');
            const { dirname } = await import('path');
            await fs.mkdir(dirname(this.filePath), { recursive: true });
            const data: SkillData = {
                skills: Array.from(this.skills.values()),
                version: SKILL_SCHEMA_VERSION,
            };
            await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
            this.dirty = false;
        } catch (err) {
            console.error('Failed to persist skill store:', err);
        }
    }

    async clear(): Promise<void> {
        this.skills.clear();
        this.dirty = true;
        await this.flush();
    }

    // ── CRUD ──────────────────────────────────────────

    /**
     * Add or update a skill. Only the consolidator should call this.
     */
    addSkill(skill: Omit<Skill, 'createdAt' | 'updatedAt'>): Skill {
        const existing = this.skills.get(skill.id);
        const now = Date.now();

        if (existing) {
            // Update: merge evidence, update success rate
            existing.successRate = (
                (existing.successRate * existing.evidenceCount + skill.successRate * skill.evidenceCount) /
                (existing.evidenceCount + skill.evidenceCount)
            );
            existing.evidenceCount += skill.evidenceCount;
            existing.derivedFrom = [...new Set([...existing.derivedFrom, ...skill.derivedFrom])];
            existing.steps = skill.steps; // take latest steps
            existing.updatedAt = now;
            if (skill.lastUsed > existing.lastUsed) existing.lastUsed = skill.lastUsed;
            this.scheduleSave();
            return existing;
        }

        const fullSkill: Skill = {
            ...skill,
            createdAt: now,
            updatedAt: now,
        };
        this.skills.set(fullSkill.id, fullSkill);
        this.scheduleSave();
        return fullSkill;
    }

    /** Record a skill being used (updates success rate and lastUsed) */
    recordUsage(skillId: string, success: boolean): boolean {
        const skill = this.skills.get(skillId);
        if (!skill) return false;

        skill.evidenceCount++;
        skill.successRate = (
            (skill.successRate * (skill.evidenceCount - 1) + (success ? 1 : 0)) /
            skill.evidenceCount
        );
        skill.lastUsed = Date.now();
        skill.updatedAt = Date.now();
        this.scheduleSave();
        return true;
    }

    /** Find skills matching an intent query (keyword matching) */
    findByIntent(query: string, limit = 3): Skill[] {
        const q = query.toLowerCase();
        const terms = q.split(/\s+/).filter(t => t.length > 2);

        const scored: Array<{ skill: Skill; score: number }> = [];

        for (const skill of this.skills.values()) {
            let score = 0;
            const intentLower = skill.intent.toLowerCase();
            const nameLower = skill.name.toLowerCase();

            // Name match
            if (nameLower.includes(q) || q.includes(nameLower)) score += 0.8;
            for (const term of terms) {
                if (nameLower.includes(term)) score += 0.3;
                if (intentLower.includes(term)) score += 0.2;
            }

            // Step content match
            for (const step of skill.steps) {
                const stepLower = step.toLowerCase();
                for (const term of terms) {
                    if (stepLower.includes(term)) score += 0.1;
                }
            }

            // Boost by success rate and recency
            score *= (0.5 + skill.successRate * 0.5);

            if (score > 0.1) {
                scored.push({ skill, score });
            }
        }

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(s => s.skill);
    }

    /** Get a skill by ID */
    getSkill(id: string): Skill | undefined {
        return this.skills.get(id);
    }

    /** Check if a skill exists by id */
    hasSkill(id: string): boolean {
        return this.skills.has(id);
    }

    /** Get all skills */
    getAllSkills(): Skill[] {
        return Array.from(this.skills.values());
    }

    /** Delete a skill */
    deleteSkill(id: string): boolean {
        if (!this.skills.has(id)) return false;
        this.skills.delete(id);
        this.scheduleSave();
        return true;
    }

    get size(): number { return this.skills.size; }

    /**
     * Format skills for LLM context.
     * Only includes high-confidence skills (successRate > 0.6).
     */
    formatForContext(skills: Skill[], maxChars = 1000): string {
        if (skills.length === 0) return '';

        const lines: string[] = ['[Learned Procedures]'];
        let charCount = lines[0].length;

        for (const skill of skills) {
            if (skill.successRate < 0.6) continue;
            const header = `• ${skill.name} (${Math.round(skill.successRate * 100)}% success, used ${skill.evidenceCount}x)`;
            if (charCount + header.length > maxChars) break;
            lines.push(header);
            charCount += header.length;

            const stepsLine = `  Steps: ${skill.steps.join(' → ')}`;
            if (charCount + stepsLine.length > maxChars) break;
            lines.push(stepsLine);
            charCount += stepsLine.length;
        }

        return lines.join('\n');
    }

    // ── Internals ─────────────────────────────────────

    private scheduleSave(): void {
        this.dirty = true;
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(async () => {
            this.saveTimer = null;
            await this.flush();
        }, 1000);
    }
}
