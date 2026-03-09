// src/utils/tool-progress.ts — Shared tool progress helpers (channel-agnostic)
// Used by Telegram, Discord, Slack and any other channel that wants to show
// tool call activity to the user.

/** Human-readable label for each tool name. Falls back to sanitized tool name. */
export const TOOL_LABELS: Record<string, string> = {
    // bootstrap tools
    find_tools: "Finding tools",
    call_tool: "Calling tool",
    project_sourcemap_tools: "Reading project map",
    read_folder_standard_tools: "Reading folder",
    forkscout_memory__recall: "Memory recall",
    forkscout_memory__remember: "Saving to memory",
    forkscout_memory__relate: "Linking memory",
    forkscout_memory__observe: "Observing",
    forkscout_memory__task: "Task management",
    forkscout_memory__context: "Loading context",
    forkscout_memory__consolidate: "Consolidating memory",
    forkscout_memory__introspect: "Inspecting memory",
    // common extended tools
    web_search_tools: "Searching the web",
    web_browser_tools: "Browser",
    http_request_tools: "HTTP request",
    read_file_tools: "Reading file",
    write_file_tools: "Writing file",
    edit_file_tools: "Editing file",
    file_search_tools: "Searching files",
    grep_search_tools: "Searching code",
    run_shell_command_tools: "Running command",
    compress_text_tools: "Compressing text",
    secret_vault_tools: "Vault",
    get_errors: "Getting errors",
    git_operations_tools: "Git",
    clipboard_tools: "Clipboard",
    telegram_message_tools: "Telegram",
    sqlite_tools: "Database",
    cron_tools: "Cron",
    n8n_tools: "n8n",
    validate_and_restart: "Validating & restarting",
    moltbook_api_tools: "Moltbook API",
};

/** Get a human-readable label for a tool name, falling back to sanitized name. */
export function toolLabel(toolName: string): string {
    return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
}

// Fields too noisy or internal to display in a progress bubble
const SKIP_FIELDS = new Set(["timeout", "signal", "stream", "headers"]);

/**
 * Render a compact multi-line preview of ALL meaningful input fields.
 * Safe to display in any channel — no HTML, plain text only.
 * Caller is responsible for HTML-escaping if needed.
 *
 * Examples:
 *   grep_search_tools({ query: "switch", path: "foo.ts" })
 *     →  "query: switch\npath: foo.ts"
 *
 *   web_browser_tools({ action: "navigate", url: "https://example.com" })
 *     →  "action: navigate\nurl: https://example.com"
 */
export function toolInputPreview(input: unknown): string {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return typeof input === "string" ? input.slice(0, 120) : "";
    }
    const i = input as Record<string, unknown>;
    const lines: string[] = [];

    for (const [k, v] of Object.entries(i)) {
        if (SKIP_FIELDS.has(k)) continue;
        if (v === undefined || v === null || v === "") continue;

        let display: string;
        if (typeof v === "string") {
            display = v.length > 120 ? v.slice(0, 117) + "…" : v;
        } else if (Array.isArray(v)) {
            const first = v[0];
            if (first && typeof first === "object" && "path" in (first as object)) {
                display = `[${(first as any).path}${v.length > 1 ? `, +${v.length - 1} more` : ""}]`;
            } else {
                display = JSON.stringify(v).slice(0, 80);
            }
        } else if (typeof v === "object") {
            display = JSON.stringify(v).slice(0, 80);
        } else {
            display = String(v);
        }
        lines.push(`${k}: ${display}`);
    }

    return lines.join("\n").slice(0, 400);
}
