/**
 * Human-readable tool call descriptions — used by sub-agent progress,
 * Telegram live updates, and any future channel that wants to show
 * what the agent is doing in real time.
 *
 * Moved here from channels/telegram/types.ts to avoid cross-layer coupling.
 *
 * @module utils/describe-tool-call
 */

const shorten = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '…' : s;
const fileTail = (p: string) => p.split('/').slice(-2).join('/');

// ── Smart command description ──
// Instead of showing raw shell commands, describe what they do in plain English.
function describeCommand(cmd: string): string {
    const c = cmd.trim();
    // Git
    if (c.startsWith('git pull')) return 'Pulling latest code';
    if (c.startsWith('git push')) return 'Pushing changes';
    if (c.startsWith('git commit')) return 'Committing changes';
    if (c.startsWith('git status')) return 'Checking git status';
    if (c.startsWith('git diff')) return 'Comparing changes';
    if (c.startsWith('git log')) return 'Viewing git history';
    if (c.startsWith('git checkout') || c.startsWith('git switch')) return 'Switching branch';
    if (c.startsWith('git branch')) return 'Managing branches';
    if (c.startsWith('git stash')) return 'Stashing changes';
    if (c.startsWith('git clone')) return 'Cloning repository';
    // Build & package
    if (/^(npm|pnpm|yarn) (install|i|add)\b/.test(c)) return 'Installing dependencies';
    if (/^(npm|pnpm|yarn) run build\b/.test(c)) return 'Building project';
    if (/^(npm|pnpm|yarn) (run )?test\b/.test(c)) return 'Running tests';
    if (/^(npm|pnpm|yarn) run dev\b/.test(c)) return 'Starting dev server';
    if (/^(npm|pnpm|yarn) run (serve|start)\b/.test(c)) return 'Starting server';
    if (/^npx tsc\b/.test(c)) return 'Type-checking code';
    // Docker
    if (c.startsWith('docker compose up') || c.startsWith('docker-compose up')) return 'Starting containers';
    if (c.startsWith('docker compose down') || c.startsWith('docker-compose down')) return 'Stopping containers';
    if (c.startsWith('docker build')) return 'Building Docker image';
    if (c.startsWith('docker ps')) return 'Checking running containers';
    if (c.startsWith('docker logs')) return 'Reading container logs';
    // System
    if (c.startsWith('cat ')) return `Reading ${fileTail(c.replace(/^cat\s+/, '').split(/\s/)[0])}`;
    if (c.startsWith('ls ') || c === 'ls') return 'Listing files';
    if (c.startsWith('mkdir')) return 'Creating directory';
    if (c.startsWith('rm ')) return 'Removing files';
    if (c.startsWith('cp ')) return 'Copying files';
    if (c.startsWith('mv ')) return 'Moving files';
    if (c.startsWith('chmod')) return 'Setting permissions';
    if (c.startsWith('curl')) return 'Making HTTP request';
    if (c.startsWith('wget')) return 'Downloading file';
    if (c.startsWith('ping')) return 'Checking connectivity';
    if (c.startsWith('lsof')) return 'Checking open ports';
    if (c.startsWith('kill')) return 'Stopping a process';
    if (c.startsWith('ps ')) return 'Checking processes';
    if (c.startsWith('arp')) return 'Scanning network devices';
    if (c.startsWith('nmap')) return 'Scanning network ports';
    // Python / Node
    if (c.startsWith('python3 ') || c.startsWith('python ')) return 'Running a Python script';
    if (c.startsWith('node ')) return 'Running a Node.js script';
    // Fallback — show first meaningful word(s) up to 40 chars
    return shorten(c, 40);
}

// ── MCP memory tool descriptions ──
function describeMemoryTool(action: string, args: Record<string, any>): string {
    switch (action) {
        case 'save_knowledge': return `🧠 Saving insight: "${shorten(args.fact || args.content || 'knowledge')}"`;
        case 'search_knowledge': return `🧠 Searching memory: "${shorten(args.query || 'query')}"`;
        case 'add_entity': return `🧠 Recording: ${args.name || 'entity'}`;
        case 'get_entity': return `🧠 Looking up: ${args.name || 'entity'}`;
        case 'update_entity': return `🧠 Updating: ${args.name || 'entity'}`;
        case 'search_entities': return `🧠 Searching entities: "${shorten(args.query || 'query')}"`;
        case 'get_all_entities': return '🧠 Loading all entities';
        case 'add_relation': return `🧠 Linking: ${args.from || '?'} → ${args.to || '?'}`;
        case 'get_all_relations': return '🧠 Loading all relations';
        case 'add_exchange': return '🧠 Recording conversation';
        case 'search_exchanges': return `🧠 Searching conversations: "${shorten(args.query || 'query')}"`;
        case 'get_self_entity': return '🧠 Loading my identity';
        case 'self_observe': return '🧠 Recording self-observation';
        case 'start_task': return `🧠 Starting task: "${shorten(args.description || args.title || 'task')}"`;
        case 'check_tasks': return '🧠 Checking active tasks';
        case 'complete_task': return '🧠 Completing task';
        case 'abort_task': return '🧠 Aborting task';
        case 'memory_stats': return '🧠 Checking memory stats';
        case 'remove_fact': return `🧠 Removing outdated fact from ${args.entityName || 'entity'}`;
        case 'get_fact_history': return `🧠 Reviewing fact history for ${args.entityName || 'entity'}`;
        case 'consolidate_memory': return '🧠 Consolidating memory';
        case 'get_stale_entities': return '🧠 Finding stale entities';
        default: return `🧠 Memory: ${action.replace(/_/g, ' ')}`;
    }
}

// ── LG TV action descriptions ──
const TV_ACTIONS: Record<string, (args: Record<string, any>) => string> = {
    'set_volume': (a) => `📺 Setting TV volume to ${a.value || '?'}`,
    'mute': (a) => `📺 ${a.value === 'true' ? 'Muting' : 'Unmuting'} TV`,
    'list_apps': () => '📺 Listing TV apps',
    'launch_app': (a) => `📺 Launching ${a.value || 'app'} on TV`,
    'toast': (a) => `📺 Sending notification to TV: "${shorten(a.value || 'message')}"`,
    'pairing': () => '📺 Pairing with TV',
    'get_info': () => '📺 Checking what\'s playing on TV',
    'power_off': () => '📺 Turning off TV',
    'power_on': () => '📺 Turning on TV',
    'screen_off': () => '📺 Turning off TV screen',
    'screen_on': () => '📺 Waking up TV screen',
};

/** Generate a human-readable description of a tool call from its name and arguments. */
export function describeToolCall(toolName: string, args: Record<string, any> = {}): string {

    // ── MCP bridged tools (prefix_action format) ──
    // Memory MCP: forkscout-memory_save_knowledge, forkscout-mem_add_entity, etc.
    if (toolName.startsWith('forkscout-mem')) {
        const action = toolName.replace(/^forkscout-mem(ory)?_/, '');
        return describeMemoryTool(action, args);
    }

    // Context7 MCP
    if (toolName.startsWith('context7_'))
        return `📖 Looking up docs: "${shorten(args.query || args.libraryName || 'library')}"`;

    // DeepWiki MCP
    if (toolName.startsWith('deepwiki_'))
        return `📖 Researching: "${shorten(args.query || args.url || 'topic')}"`;

    // Sequential thinking MCP
    if (toolName.startsWith('sequential-thinking_'))
        return '💭 Reasoning step by step';

    // Generic MCP fallback — strip prefix and humanize
    if (toolName.includes('_') && /^[a-z]+-[a-z]+_/.test(toolName)) {
        const parts = toolName.split('_');
        const server = parts[0].replace(/-/g, ' ');
        const action = parts.slice(1).join(' ');
        return `🔌 ${server}: ${action}`;
    }

    switch (toolName) {
        // ── Shell & system ──
        case 'run_command':
            return `⚙️ ${describeCommand(args.command || 'command')}`;
        case 'self_rebuild':
            return `🔨 Rebuilding myself — ${shorten(args.reason || 'updating code')}`;

        // ── Files ──
        case 'read_file':
            return `📄 Reading ${fileTail(args.path || 'file')}`;
        case 'write_file':
            return `📝 Writing to ${fileTail(args.path || 'file')}`;
        case 'append_file':
            return `📝 Appending to ${fileTail(args.path || 'file')}`;
        case 'delete_file':
            return `🗑 Deleting ${fileTail(args.path || 'file')}`;
        case 'list_directory':
            return `📂 Listing ${fileTail(args.path || '.')}`;
        case 'safe_self_edit':
            return `🛠 Editing ${fileTail(args.path || 'file')} — ${shorten(args.reason || 'update')}`;

        // ── Web ──
        case 'web_search':
            return `🔍 Searching: "${shorten(args.query || 'query')}"`;
        case 'browse_web':
            return `🌐 Browsing ${shorten(args.url || 'page')}`;
        case 'browser_screenshot':
            return `📸 Taking screenshot of ${shorten(args.url || 'page')}`;
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

        // ── Memory & knowledge (direct, non-MCP) ──
        case 'save_knowledge':
            return `🧠 Saving: "${shorten(args.fact || 'fact')}"`;
        case 'search_knowledge':
            return `🧠 Searching memory: "${shorten(args.query || 'query')}"`;
        case 'memory_store':
            return '🧠 Storing in memory';
        case 'memory_recall':
            return '🧠 Recalling from memory';
        case 'add_entity':
            return `🧠 Recording ${args.type || 'entity'}: ${args.name || '?'}`;
        case 'add_relation':
            return `🧠 Linking: ${args.from || '?'} → ${args.to || '?'} (${args.type || 'related'})`;
        case 'search_graph':
            return `🧠 Searching knowledge graph: "${shorten(args.query || 'query')}"`;
        case 'graph_stats':
            return '🧠 Checking knowledge graph stats';
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
        case 'check_usage':
            return '📊 Checking usage analytics';
        case 'set_model_tier':
            return `🎛 Switching to ${args.tier || '?'} model: ${args.modelId || '?'}`;

        // ── Telegram ──
        case 'send_telegram_message':
            return `💬 Sending message${args.lookup ? ' to ' + args.lookup : ''}`;
        case 'send_telegram_photo':
            return `📷 Sending photo: ${fileTail(args.filePath || 'image')}`;
        case 'send_telegram_file':
            return `📎 Sending file: ${fileTail(args.filePath || 'file')}`;

        // ── Channel auth ──
        case 'grant_channel_access':
            return `🔑 Granting ${args.role || 'access'} to user ${args.userId || '?'} on ${args.channel || 'channel'}`;
        case 'revoke_channel_access':
            return `🔑 Revoking access for user ${args.userId || '?'}`;
        case 'list_channel_users':
            return `🔑 Listing users${args.channel ? ' on ' + args.channel : ''}`;

        // ── MCP management ──
        case 'add_mcp_server':
            return `🔌 Adding MCP server: ${args.name || '?'}`;
        case 'remove_mcp_server':
            return `🔌 Removing MCP server: ${args.name || '?'}`;
        case 'list_mcp_servers':
            return '🔌 Listing MCP servers';

        // ── LG TV ──
        case 'lg_tv_control': {
            const handler = TV_ACTIONS[args.action];
            return handler ? handler(args) : `📺 TV: ${(args.action || 'control').replace(/_/g, ' ')}`;
        }

        // ── TTS ──
        case 'tts_generate_voice':
            return `🔊 Generating voice: "${shorten(args.text || 'audio', 40)}"`;

        // ── Network ──
        case 'scan_local_network':
            return `📡 Scanning local network (${args.subnetPrefix || '192.168.1'}.*)`;
        case 'scan_target_ports':
            return `📡 Scanning ports on ${args.targetIp || '?'}`;

        // ── Agent tools ──
        case 'spawn_agents':
            return '🤖 Spawning sub-agents';
        case 'manage_todos':
            return '📋 Updating task list';
        case 'think':
            return '💭 Thinking…';
        case 'deliver_answer':
            return '✅ Preparing answer';
        case 'manage_personality':
            return '🎭 Adjusting personality';

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

        default: {
            // Last resort: humanize snake_case tool name
            const humanized = toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `⚙️ ${humanized}`;
        }
    }
}
