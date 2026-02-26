// src/skills/index.ts
// Public API for agent skills discovery.
// Called from agent/index.ts during buildAgentParams().

import { resolve } from "path";
import type { AppConfig } from "@/config.ts";
import { discoverSkills, loadSkillBody, type SkillMetadata } from "@/skills/auto_discover_skills.ts";

export type { SkillMetadata };
export { loadSkillBody };

/** Default skill scan directories relative to the project root. */
const DEFAULT_SKILL_DIRS = [
    ".agents/skills",       // standard: populated by `npx skills add <repo>`
    "src/skills/built-in",  // built-in skills bundled with ForkScout
];

/**
 * Resolve skill directories from config (or fall back to defaults).
 * All paths are resolved relative to process.cwd().
 */
export function getSkillDirs(config: AppConfig): string[] {
    const dirs = config.skills?.dirs ?? DEFAULT_SKILL_DIRS;
    return dirs.map((d) => resolve(process.cwd(), d));
}

/**
 * Discover all skills available to the agent.
 * Called once per agent run in buildAgentParams().
 */
export function getSkills(config: AppConfig): SkillMetadata[] {
    return discoverSkills(getSkillDirs(config));
}
