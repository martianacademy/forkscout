// src/tools/load_skill_tools.ts — Discover, search, find, install, and load agent skills.
// Local search + skills.sh ecosystem discovery + auto-install.
// Compatible with the skills.sh ecosystem (npx skills add).

import { tool } from "ai";
import { z } from "zod";
import { getConfig } from "@/config.ts";
import { discoverSkills, loadSkillBody, getSkillDirs, type SkillMetadata } from "@/skills/auto_discover_skills.ts";
import { log } from "@/logs/logger.ts";
import { $ } from "bun";

const logger = log("skills");

// ── Relevance scoring ────────────────────────────────────────────────────────

function scoreSkill(skill: SkillMetadata, queryTerms: string[], rawQuery: string): number {
    const name = skill.name.toLowerCase();
    const desc = skill.description.toLowerCase();
    const q = rawQuery.toLowerCase();

    if (name === q) return 1.0;

    let score = 0;
    let signals = 0;

    if (name.includes(q) || q.includes(name)) {
        score += 0.8;
        signals++;
    }

    const nameWords = name.split(/[\s\-_]+/);
    const descWords = desc.split(/[\s\-_.,;:!?()]+/);

    for (const term of queryTerms) {
        if (nameWords.some(w => w === term)) { score += 0.6; signals++; }
        else if (descWords.some(w => w === term)) { score += 0.3; signals++; }
        else if (nameWords.some(w => w.startsWith(term) || term.startsWith(w))) { score += 0.2; signals++; }
        else if (descWords.some(w => w.startsWith(term) || term.startsWith(w))) { score += 0.1; signals++; }
    }

    const termCoverage = signals / Math.max(queryTerms.length, 1);
    return Math.min(score * termCoverage, 1.0);
}

// ── Shell helpers ────────────────────────────────────────────────────────────

async function runSkillsCli(args: string): Promise<{ ok: boolean; output: string }> {
    try {
        const result = await $`npx -y skills ${args}`.text();
        return { ok: true, output: result.trim() };
    } catch (err: any) {
        const output = err?.stdout?.toString?.() ?? err?.message ?? String(err);
        return { ok: false, output: output.trim() };
    }
}

// ── Tool definition ──────────────────────────────────────────────────────────

export const load_skill_tools = tool({
    description:
        "Discover, search, find, install, and load agent skills. " +
        "action='search' — search LOCALLY installed skills by relevance. " +
        "action='find' — search the ONLINE skills.sh ecosystem for new skills (uses `npx skills find`). " +
        "action='install' — install a skill from skills.sh (uses `npx skills add`). " +
        "action='load' — get the full SKILL.md instructions for an installed skill. " +
        "action='list' — list all installed skill names. " +
        "WORKFLOW: search locally → not found? → find online → install → load. " +
        "Example: { action: 'find', query: 'react best practices' } " +
        "Example: { action: 'install', package: 'vercel-labs/agent-skills', skill_name: 'web-design-guidelines' }",
    inputSchema: z.object({
        action: z.enum(["list", "search", "find", "install", "load"]).describe(
            "list = local names, search = local ranked, find = online search, install = auto-install, load = read instructions"
        ),
        query: z.string().optional().describe("Search query (required for search/find)"),
        skill_name: z.string().optional().describe("Skill name (required for load, optional for install)"),
        package: z.string().optional().describe("Package to install from, e.g. 'vercel-labs/agent-skills' (required for install)"),
        max_results: z.number().optional().default(10).describe("Max results for search (default 10)"),
    }),
    execute: async (input) => {
        const config = getConfig();
        const skills = discoverSkills(getSkillDirs(config));

        // ── LIST ─────────────────────────────────────────────────────────
        if (input.action === "list") {
            if (skills.length === 0) {
                return {
                    success: true,
                    skills: [],
                    message: "No skills installed. Use action='find' to discover skills from skills.sh",
                };
            }
            return {
                success: true,
                skills: skills.map(s => ({ name: s.name, description: s.description })),
                count: skills.length,
            };
        }

        // ── SEARCH (local) ───────────────────────────────────────────────
        if (input.action === "search") {
            if (!input.query) return { success: false, error: "query is required for action=search" };

            const terms = input.query.trim().toLowerCase().split(/[\s\-_,]+/).filter(t => t.length > 1);
            if (terms.length === 0) return { success: false, error: "Query too short." };

            const scored = skills
                .map(s => ({ ...s, score: scoreSkill(s, terms, input.query!) }))
                .filter(s => s.score > 0.05)
                .sort((a, b) => b.score - a.score)
                .slice(0, input.max_results ?? 10);

            if (scored.length === 0) {
                return {
                    success: true,
                    results: [],
                    message: `No local skills match "${input.query}". Try action='find' to search the online skills.sh ecosystem.`,
                    total_installed: skills.length,
                };
            }

            return {
                success: true,
                results: scored.map(s => ({ name: s.name, description: s.description, relevance: Math.round(s.score * 100) + "%" })),
                total_installed: skills.length,
            };
        }

        // ── FIND (online — skills.sh ecosystem) ─────────────────────────
        if (input.action === "find") {
            if (!input.query) return { success: false, error: "query is required for action=find" };

            logger.info(`[skills] Searching skills.sh for: ${input.query}`);
            const { ok, output } = await runSkillsCli(`find ${input.query}`);

            if (!ok) {
                return {
                    success: false,
                    error: "Failed to search skills.sh. Make sure you have internet access.",
                    details: output,
                    hint: "You can also browse https://skills.sh/ manually.",
                };
            }

            return {
                success: true,
                source: "skills.sh",
                results: output,
                hint: "Use action='install' with package and skill_name to install a skill.",
            };
        }

        // ── INSTALL ──────────────────────────────────────────────────────
        if (input.action === "install") {
            if (!input.package) return { success: false, error: "package is required for install (e.g. 'vercel-labs/agent-skills')" };

            const skillFlag = input.skill_name ? ` --skill ${input.skill_name}` : "";
            const cmd = `add ${input.package}${skillFlag} -y`;

            logger.info(`[skills] Installing: npx skills ${cmd}`);
            const { ok, output } = await runSkillsCli(cmd);

            if (!ok) {
                return {
                    success: false,
                    error: `Failed to install skill from ${input.package}.`,
                    details: output,
                };
            }

            // Re-discover after install
            const updatedSkills = discoverSkills(getSkillDirs(config));
            return {
                success: true,
                message: `Skill installed from ${input.package}.`,
                details: output,
                installed_skills: updatedSkills.length,
                hint: input.skill_name
                    ? `Now use action='load' with skill_name='${input.skill_name}' to read its instructions.`
                    : "Use action='list' to see all installed skills.",
            };
        }

        // ── LOAD ─────────────────────────────────────────────────────────
        if (!input.skill_name) return { success: false, error: "skill_name is required for action=load" };

        const match = skills.find(s => s.name.toLowerCase() === input.skill_name!.toLowerCase());

        if (!match) {
            const terms = input.skill_name.toLowerCase().split(/[\s\-_]+/).filter(t => t.length > 1);
            const suggestions = skills
                .map(s => ({ name: s.name, score: scoreSkill(s, terms, input.skill_name!) }))
                .filter(s => s.score > 0.1)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map(s => s.name);

            return {
                success: false,
                error: `Skill "${input.skill_name}" not found locally.`,
                ...(suggestions.length > 0 ? { did_you_mean: suggestions } : {}),
                hint: `Try action='find' with query='${input.skill_name}' to search online.`,
            };
        }

        const body = loadSkillBody(match.path);
        if (!body) return { success: false, error: `SKILL.md for "${match.name}" could not be read.` };

        return {
            success: true,
            skill: match.name,
            description: match.description,
            path: match.path,
            instructions: body,
        };
    },
});
