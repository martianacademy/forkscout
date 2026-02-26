// src/skills/auto_discover_skills.ts
// Scans configured skill directories for SKILL.md files.
// Returns only { name, description, path } — the full body is never loaded until `load_skill` is called.
//
// Scan directories (in order — first name wins):
//   1. Each path in `config.skills.dirs`
//   2. Default: [".agents/skills", "src/skills/built-in"]
//
// Skill folder layout:
//   <dir>/<skill-name>/SKILL.md   ← YAML frontmatter + instructions

import { readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { log } from "@/logs/logger.ts";

const logger = log("skills-discover");

export interface SkillMetadata {
    /** Short identifier from frontmatter `name:` */
    name: string;
    /** Description from frontmatter `description:` — shown in system prompt */
    description: string;
    /** Absolute path to the skill directory (parent of SKILL.md) */
    path: string;
}

/** Parse YAML-style frontmatter between `---` delimiters. Returns null if invalid. */
function parseFrontmatter(content: string): Record<string, string> | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match?.[1]) return null;
    const result: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key && value) result[key] = value;
    }
    return result;
}

/**
 * Discover all valid skills from the given directory list.
 * Returns metadata sorted by directory order (first name wins for duplicates).
 */
export function discoverSkills(dirs: string[]): SkillMetadata[] {
    const skills: SkillMetadata[] = [];
    const seenNames = new Set<string>();

    for (const dir of dirs) {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            continue; // directory doesn't exist — skip silently
        }

        for (const entry of entries) {
            const skillDir = resolve(dir, entry);
            try {
                if (!statSync(skillDir).isDirectory()) continue;
            } catch {
                continue;
            }

            const skillFile = resolve(skillDir, "SKILL.md");
            try {
                const content = readFileSync(skillFile, "utf-8");
                const front = parseFrontmatter(content);
                if (!front?.name || !front?.description) continue;

                // First skill with a given name wins (project overrides built-ins)
                if (seenNames.has(front.name)) continue;
                seenNames.add(front.name);

                skills.push({ name: front.name, description: front.description, path: skillDir });
            } catch {
                continue; // missing SKILL.md or parse error — skip
            }
        }
    }

    logger.info(`Discovered ${skills.length} skill(s) from ${dirs.length} director${dirs.length === 1 ? "y" : "ies"}`);
    return skills;
}

/**
 * Read and return the body of a skill's SKILL.md (frontmatter stripped).
 * Returns null if the skill file cannot be read.
 */
export function loadSkillBody(skillPath: string): string | null {
    const skillFile = resolve(skillPath, "SKILL.md");
    try {
        const content = readFileSync(skillFile, "utf-8");
        // Strip frontmatter block
        const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
        return stripped;
    } catch {
        return null;
    }
}
