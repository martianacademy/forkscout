/**
 * Human-readable tool call descriptions — used by sub-agent progress,
 * Telegram live updates, and any future channel that wants to show
 * what the agent is doing in real time.
 *
 * Moved here from channels/telegram/types.ts to avoid cross-layer coupling.
 *
 * @module utils/describe-tool-call
 */

/** Generate a human-readable description of a tool call from its name and arguments. */
export function describeToolCall(toolName: string, args: Record<string, any> = {}): string {
    const shorten = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '…' : s;
    const file = (p: string) => p.split('/').slice(-2).join('/'); // show last 2 path segments

    switch (toolName) {
        // ── Shell & system ──
        case 'run_command':
            return `⚙️ Running: \`${shorten(args.command || 'command', 80)}\``;
        case 'self_rebuild':
            return `🔨 Rebuilding myself — ${shorten(args.reason || 'updating code')}`;

        // ── Files ──
        case 'read_file':
            return `📄 Reading ${file(args.path || 'file')}`;
        case 'write_file':
            return `📝 Writing to ${file(args.path || 'file')}`;
        case 'append_file':
            return `📝 Appending to ${file(args.path || 'file')}`;
        case 'delete_file':
            return `🗑 Deleting ${file(args.path || 'file')}`;
        case 'list_directory':
            return `📂 Listing ${file(args.path || '.')}`;
        case 'safe_self_edit':
            return `🛠 Editing ${file(args.path || 'file')} — ${shorten(args.reason || 'update')}`;

        // ── Web ──
        case 'web_search':
            return `🔍 Searching: "${shorten(args.query || 'query')}"`;
        case 'browse_web':
            return `🌐 Browsing ${shorten(args.url || 'page')}`;
        case 'browser_screenshot':
            return `📸 Screenshotting ${shorten(args.url || 'page')}`;
        case 'http_request':
            return `🌐 ${(args.method || 'GET').toUpperCase()} ${shorten(args.url || 'endpoint')}`;

        // ── Scheduler ──
        case 'schedule_job':
            return `⏰ Scheduling "${args.name || 'job'}" — ${shorten(args.schedule || 'cron')}`;
        case 'list_jobs':
            return '⏰ Listing all scheduled jobs';
        case 'remove_job':
            return `⏰ Removing job: ${args.jobId || 'unknown'}`;
        case 'pause_job':
            return `⏸ Pausing job: ${args.jobId || 'unknown'}`;
        case 'resume_job':
            return `▶️ Resuming job: ${args.jobId || 'unknown'}`;

        // ── Memory & knowledge ──
        case 'save_knowledge':
            return `🧠 Saving: "${shorten(args.fact || 'fact')}"`;
        case 'search_knowledge':
            return `🧠 Searching memory: "${shorten(args.query || 'query')}"`;
        case 'memory_store':
            return `🧠 Storing in memory`;
        case 'memory_recall':
            return `🧠 Recalling from memory`;
        case 'add_entity':
            return `📚 Adding ${args.type || 'entity'}: ${args.name || '?'}`;
        case 'add_relation':
            return `📚 Linking: ${args.from || '?'} → ${args.to || '?'} (${args.type || 'related'})`;
        case 'search_graph':
            return `📚 Searching knowledge graph: "${shorten(args.query || 'query')}"`;
        case 'graph_stats':
            return '📚 Checking knowledge graph stats';
        case 'self_reflect':
            return `🪞 Reflecting: "${shorten(args.observation || 'thought')}"`;
        case 'self_inspect':
            return '🔎 Inspecting my own state';
        case 'clear_memory':
            return `🧹 Clearing memory — ${shorten(args.reason || 'cleanup')}`;

        // ── Survival & system ──
        case 'check_vitals':
            return '💓 Checking system vitals';
        case 'backup_memory':
            return `💾 Backing up memory${args.reason ? ' — ' + shorten(args.reason) : ''}`;
        case 'system_status':
            return '📊 Checking system status';
        case 'check_budget':
            return '💰 Checking budget usage';
        case 'set_model_tier':
            return `🎛 Setting ${args.tier || 'tier'} model to ${args.modelId || '?'}`;
        case 'set_budget_limit':
            return `💰 Updating budget limits`;

        // ── Telegram ──
        case 'send_telegram_message':
            return `💬 Sending message${args.lookup ? ' to ' + args.lookup : ''}`;
        case 'send_telegram_photo':
            return `📷 Sending photo: ${file(args.filePath || 'image')}`;
        case 'send_telegram_file':
            return `📎 Sending file: ${file(args.filePath || 'file')}`;

        // ── Channel auth ──
        case 'grant_channel_access':
            return `🔑 Granting ${args.role || 'access'} to user ${args.userId || '?'} on ${args.channel || 'channel'}`;
        case 'revoke_channel_access':
            return `🔑 Revoking access for user ${args.userId || '?'}`;
        case 'list_channel_users':
            return `🔑 Listing users${args.channel ? ' on ' + args.channel : ''}`;

        // ── MCP ──
        case 'add_mcp_server':
            return `🔌 Adding MCP server: ${args.name || '?'}`;
        case 'remove_mcp_server':
            return `🔌 Removing MCP server: ${args.name || '?'}`;
        case 'list_mcp_servers':
            return '🔌 Listing MCP servers';

        // ── Other ──
        case 'date_time':
        case 'get_current_date':
            return '🕐 Checking date/time';
        case 'list_secrets':
            return '🔑 Checking available secrets';
        case 'generate_presentation':
            return `📊 Generating presentation: "${shorten(args.title || 'slides')}"`;
        case 'view_activity_log':
            return `📋 Viewing activity log (last ${args.count || '?'}${args.type ? ', ' + args.type : ''})`;

        default:
            return `⚙️ ${toolName}`;
    }
}
