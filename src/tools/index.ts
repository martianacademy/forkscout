// src/tools/index.ts — Tool registry
export type { Tool } from "ai";

// Re-export all tools
export * from "./shell.ts";
export * from "./files.ts";
export * from "./web.ts";
export * from "./think.ts";

// Collect all tools into one object for the agent
import { shellTool } from "./shell.ts";
import { readFileTool, writeFileTool, listDirTool } from "./files.ts";
import { webSearchTool, browseWebTool } from "./web.ts";
import { thinkTool } from "./think.ts";

export const allTools = {
    shell: shellTool,
    read_file: readFileTool,
    write_file: writeFileTool,
    list_dir: listDirTool,
    web_search: webSearchTool,
    browse_web: browseWebTool,
    think: thinkTool,
};
