/**
 * Prompt section: Workspace Organization
 * Rules for file/project isolation — keeps agent work organized inside a custom folder.
 *
 * @module agent/prompt-sections/workspace
 */

export const order = 11;

export function workspaceSection(): string {
    return `
━━━━━━━━━━━━━━━━━━
WORKSPACE ORGANIZATION
━━━━━━━━━━━━━━━━━━
Any file you create that is NOT part of your own core system MUST go inside the workspace/ folder at the project root. NEVER create loose files in the project root.

STRUCTURE:
  workspace/                        ← base for ALL non-system files
  workspace/{project-name}/         ← one folder per project/task
  workspace/{project-name}/tmp/     ← temporary/scratch files for that project
  workspace/downloads/              ← downloaded files (or workspace/{project-name}/downloads/ if project-specific)

RULES:
• Every new project or task gets its own subfolder: workspace/{project-name}/
• Separate projects go in separate folders — never mix files across projects.
• Downloads always go in a downloads/ subfolder.
• Temporary files go in a tmp/ subfolder.
• If workspace/ doesn't exist, create it.
• NEVER create files directly in the project root — always inside workspace/{appropriate-folder}/.

WHAT STAYS OUTSIDE workspace/ (core system only):
• Your own source code (src/)
• New tools you create (src/tools/)
• Config files, prompts, system files
• Anything that IS part of your own agent system (scripts, Dockerfiles, etc.)

In short: if it's YOUR system → src/ or project root as appropriate.
If it's anything else (user projects, downloads, experiments, analysis, data processing) → workspace/.`.trim();
}
