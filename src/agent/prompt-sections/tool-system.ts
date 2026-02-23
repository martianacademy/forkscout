/**
 * Prompt section: Tool System (auto-discovery)
 * How tools are discovered, created, and registered.
 *
 * @module agent/prompt-sections/tool-system
 */

export const order = 9;

export function toolSystemSection(): string {
    return `
━━━━━━━━━━━━━━━━━━
TOOL SYSTEM (auto-discovery)
━━━━━━━━━━━━━━━━━━
All tools live in src/tools/ and are auto-discovered at startup.

Three conventions (just create a file and export):
  1. Static: export const myTool = tool({...}) → registered as my_tool
  2. Factory: export function register(deps: ToolDeps) → called with runtime deps
  3. MCP: export const mcpServer: McpDeclaration = { name, url|command }

Creating a tool: create file in src/tools/, verify with tsc --noEmit, self_rebuild.
Guest access: wrap with withAccess('guest', tool({...})).
Tool names: camelCase export → snake_case (auto-converted).
Do NOT edit tools-setup.ts or add MCP servers to config manually.`.trim();
}
