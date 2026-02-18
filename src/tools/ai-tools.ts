/**
 * AI SDK v6 tool definitions — barrel file.
 *
 * Each tool group lives in its own file for safe self-editing.
 * This file re-exports everything and assembles the `coreTools` map.
 */

// ── Static tool exports ─────────────────────────────────
export { readFile, writeFile, appendFile, listDirectory, deleteFile } from './file-tools';
export { runCommand } from './command-tool';
export { webSearch, browseWeb, browserScreenshot } from './web-tools';
export { getCurrentDate, generatePresentation } from './utility-tools';
export { safeSelfEdit } from './self-edit-tool';
export { createSelfRebuildTool } from './self-rebuild-tool';
export { listSecrets, httpRequest } from './secret-tools';
export { viewActivityLog } from './activity-tool';
export { think } from './think-tool';

// ── Factory function exports ────────────────────────────
export { createSchedulerTools } from './scheduler-tools';
export { createMcpTools } from './mcp-tools';
export { createSurvivalTools } from './survival-tools';
export { createChannelAuthTools } from './channel-tools';
export { createTelegramTools } from './telegram-tools';
export { createBudgetTools } from './budget-tools';

// ── Aggregate core tools map ────────────────────────────
import { readFile, writeFile, appendFile, listDirectory, deleteFile } from './file-tools';
import { runCommand } from './command-tool';
import { webSearch, browseWeb, browserScreenshot } from './web-tools';
import { getCurrentDate, generatePresentation } from './utility-tools';
import { safeSelfEdit } from './self-edit-tool';
import { listSecrets, httpRequest } from './secret-tools';
import { viewActivityLog } from './activity-tool';
import { think } from './think-tool';

export const coreTools = {
    read_file: readFile,
    write_file: writeFile,
    append_file: appendFile,
    list_directory: listDirectory,
    delete_file: deleteFile,
    run_command: runCommand,
    web_search: webSearch,
    browse_web: browseWeb,
    browser_screenshot: browserScreenshot,
    get_current_date: getCurrentDate,
    generate_presentation: generatePresentation,
    safe_self_edit: safeSelfEdit,
    list_secrets: listSecrets,
    http_request: httpRequest,
    view_activity_log: viewActivityLog,
    think,
};
