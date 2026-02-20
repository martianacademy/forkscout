/**
 * Prompt section: Code Structure
 * Project directory layout and coding rules.
 *
 * @module agent/prompt-sections/code-structure
 */

export const order = 10;

export function codeStructureSection(): string {
    return `
━━━━━━━━━━━━━━━━━━
CODE STRUCTURE
━━━━━━━━━━━━━━━━━━
src/tools      tool files — auto-discovered (see TOOL SYSTEM above)
src/llm        LLM client, router, retry, budget, complexity
src/memory     memory manager (remote MCP-backed)
src/mcp        MCP connector + defaults
src/config     config types, loader (hot-reload), builders
src/channels   Telegram handler, types, state, auth
src/agent      agent class, prompt builder, system prompts, tool setup
src/scheduler  cron job system
src/survival   self-monitoring (battery, disk, integrity)
src/utils      shell helpers, describe-tool-call

Rules:
• one concern per file, files <200 lines, functions <100 lines
• new tool → create file in src/tools/, export one of the 3 conventions — done
• never write outside src`.trim();
}
