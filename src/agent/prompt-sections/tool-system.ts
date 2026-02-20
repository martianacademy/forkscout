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
All tools live in src/tools/. Everything is auto-discovered at startup — no manual registration.

THREE CONVENTIONS (just create a file and export):

1. STATIC TOOL — for tools with no runtime dependencies:
   \`\`\`
   // src/tools/my-tool.ts
   import { tool } from 'ai';
   import { z } from 'zod';
   export const myTool = tool({
       description: 'What this tool does',
       inputSchema: z.object({ input: z.string() }),
       execute: async ({ input }) => { return 'result'; },
   });
   \`\`\`
   → Auto-registered as "my_tool" (camelCase → snake_case).

2. FACTORY TOOL — for tools that need runtime deps (scheduler, router, memory, etc.):
   \`\`\`
   // src/tools/my-service-tools.ts
   import type { ToolDeps } from './deps';
   export function register(deps: ToolDeps) {
       return {
           my_service_action: tool({ description: '...', inputSchema: z.object({...}),
               execute: async (input) => { deps.router.getModel('chat'); ... },
           }),
       };
   }
   \`\`\`
   → register(deps) called automatically with ToolDeps at startup.
   ToolDeps contains: scheduler, router, survival, channelAuth, memory, mcpConnector, toolSet, mcpConfigPath.

3. MCP SERVER — to connect an external MCP server:
   \`\`\`
   // src/tools/my-server.mcp.ts
   import type { McpDeclaration } from './deps';
   export const mcpServer: McpDeclaration = {
       name: 'my-server',
       url: 'https://example.com/mcp',  // OR command: 'npx', args: ['-y', 'pkg']
   };
   \`\`\`
   → Auto-connected during agent init. Config overrides in forkscout.config.json agent.mcpServers.

CREATING A NEW TOOL (full process):
1. Create the file in src/tools/ using one of the 3 conventions above.
2. For guest access: wrap with withAccess('guest', tool({...})) — import from './access'.
3. Verify: run \`npx tsc --noEmit\` — must be 0 errors.
4. Restart the agent (self_rebuild) — the tool auto-registers on next startup.
5. Verify registration: check the startup log for "[Auto-Loader]: Discovered N static tools, N factories, N MCP servers".
6. Record in memory: add_entity for the new tool file with facts about what it does.

DO NOT:
• Edit tools-setup.ts (fully auto-discovered now)
• Manually add MCP servers to forkscout.config.json (use *.mcp.ts files instead)

SPECIAL CASES:
• Telegram tools — deferred until bridge connects (only exception to auto-discovery)
• Access control — default is admin-only. Use withAccess('guest', ...) from src/tools/access.ts for guest tools.
• Tool names — export name is auto-converted: camelCase → snake_case (e.g. myTool → my_tool)

DISCOVERY AT RUNTIME:
• discoverAllTools() from src/tools/auto-loader.ts returns { staticTools, factories, mcpServers }
• To inspect what's registered: Object.keys(toolSet) on the live agent`.trim();
}
