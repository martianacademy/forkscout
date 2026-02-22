/**
 * Tool Index — in-memory searchable catalog of all registered tools.
 *
 * Built at agent startup after all tools (static, factory, MCP) are registered.
 * Provides:
 *   - Full tool metadata: name, description, parameters, category
 *   - Text search across names, descriptions, param names
 *   - Category-based grouping for semantic discovery
 *
 * This is the backbone of the Tool RAG system — the LLM uses `search_tools`
 * to discover relevant tools on-demand instead of loading all 50+ tool
 * definitions into every request.
 *
 * @module tools/tool-index
 */

// ── Types ──────────────────────────────────────────────

export interface ToolEntry {
    /** Tool name (snake_case) */
    name: string;
    /** Human-readable description from the tool definition */
    description: string;
    /** Parameter names and their descriptions */
    parameters: ParameterEntry[];
    /** Category for grouping */
    category: string;
    /** Whether this tool is from an MCP server */
    isMcp: boolean;
    /** Source file or MCP server name */
    source: string;
}

export interface ParameterEntry {
    name: string;
    type: string;
    description: string;
    required: boolean;
}

export interface SearchResult {
    tool: ToolEntry;
    /** Relevance score (higher = better match) */
    score: number;
    /** Which fields matched the query */
    matchedOn: string[];
}

// ── Index Storage ──────────────────────────────────────

let toolEntries: ToolEntry[] = [];
/** name → combined searchable text (lowercased) for fast matching */
let searchableText: Map<string, string> = new Map();

// ── Category Inference ─────────────────────────────────

/**
 * Maps tool name patterns to semantic categories.
 * Order matters — first match wins.
 */
const CATEGORY_RULES: Array<[RegExp, string]> = [
    // Core reasoning / flow
    [/^(think|deliver_answer|manage_todos)$/, 'reasoning'],
    [/^sequential_thinking$/, 'reasoning'],
    // Sub-agents
    [/^(spawn_agent|spawn_agents)$/, 'sub-agents'],
    // Filesystem
    [/^(read_file|write_file|append_file|list_directory|delete_file)$/, 'filesystem'],
    // System / shell
    [/^run_command$/, 'system'],
    // Web
    [/^(web_search|browse_web|browser_screenshot)$/, 'web'],
    // Telegram / messaging
    [/send_telegram|edit_telegram|reply_telegram|telegram_/, 'telegram'],
    // Voice / TTS
    [/^tts_/, 'voice'],
    // Secrets
    [/^(get_secret|set_secret)$/, 'secrets'],
    // MCP management
    [/^(add_mcp_server|remove_mcp_server|list_mcp_servers|refresh_mcp_server)$/, 'mcp-management'],
    // Channel auth
    [/^(authorize_user|revoke_user|list_authorized)$/, 'channel-auth'],
    // Survival / self-modification
    [/^(health_check|self_edit|self_rebuild|safe_self_edit)$/, 'survival'],
    // Budget / usage
    [/^(check_budget|get_usage)/, 'budget'],
    // Network
    [/^(scan_network|wake_on_lan)$/, 'network'],
    // Smart home
    [/^(lg_tv|lgtv)/, 'smart-home'],
    // Activity log
    [/^(get_activity|activity_)/, 'activity'],
    // Personality
    [/^(list_personalities|switch_personality|save_personality)/, 'personality'],
    // Notebook
    [/^(moltbook_|create_notebook)/, 'notebook'],
    // MCP-bridged tools: forkscout_memory_*, context7_*, deepwiki_*
    [/^forkscout_memory_/, 'memory'],
    [/^context7_/, 'documentation'],
    [/^deepwiki_/, 'documentation'],
];

function inferCategory(name: string): string {
    for (const [pattern, category] of CATEGORY_RULES) {
        if (pattern.test(name)) return category;
    }
    return 'general';
}

// ── Parameter Extraction ───────────────────────────────

/**
 * Extract parameter info from a tool definition.
 * Handles both Zod schemas (local tools) and JSON Schema (MCP bridge tools).
 */
function extractParameters(toolDef: any): ParameterEntry[] {
    const params: ParameterEntry[] = [];

    // AI SDK tools store schema at inputSchema or parameters
    const schema = toolDef?.inputSchema ?? toolDef?.parameters;
    if (!schema) return params;

    // Zod object schema — has _def.shape()
    try {
        const shape = schema?._def?.shape?.() ?? schema?.shape;
        if (shape && typeof shape === 'object') {
            for (const [key, fieldSchema] of Object.entries(shape)) {
                const field = fieldSchema as any;
                params.push({
                    name: key,
                    type: field?._def?.typeName?.replace('Zod', '')?.toLowerCase() ?? 'unknown',
                    description: field?.description ?? field?._def?.description ?? '',
                    required: !(field?.isOptional?.()),
                });
            }
            return params;
        }
    } catch {
        // Fall through to JSON Schema extraction
    }

    // JSON Schema (from MCP bridge tools)
    if (schema?.properties && typeof schema.properties === 'object') {
        const requiredSet = new Set<string>(schema.required ?? []);
        for (const [key, prop] of Object.entries(schema.properties)) {
            const p = prop as any;
            params.push({
                name: key,
                type: p.type ?? 'unknown',
                description: p.description ?? '',
                required: requiredSet.has(key),
            });
        }
    }

    return params;
}

// ── Search Text Builder ────────────────────────────────

/**
 * Combine all relevant text for a tool into one lowercase string.
 * Used for fast keyword matching.
 */
function buildSearchableText(entry: ToolEntry): string {
    const parts = [
        entry.name.replace(/_/g, ' '),
        entry.description,
        entry.category,
        ...entry.parameters.map(p => `${p.name} ${p.description}`),
    ];
    return parts.join(' ').toLowerCase();
}

// ── Index Building ─────────────────────────────────────

/**
 * Build the tool index from the live toolSet.
 *
 * Call AFTER all tools are registered:
 *   - Static tools from auto-loader
 *   - Factory tools (register(deps))
 *   - MCP bridge tools (after mcpConnector.connectAll())
 *
 * Can be called again to rebuild (e.g., after MCP tools change).
 */
export function buildToolIndex(
    toolSet: Record<string, any>,
    mcpToolNames?: Set<string>,
): void {
    toolEntries = [];
    searchableText = new Map();

    for (const [name, toolDef] of Object.entries(toolSet)) {
        if (!toolDef || typeof toolDef !== 'object') continue;

        const description = typeof toolDef.description === 'string'
            ? toolDef.description
            : '';

        const isMcp = mcpToolNames?.has(name) ?? (name.includes('_') && (
            name.startsWith('forkscout_memory_') ||
            name.startsWith('context7_') ||
            name.startsWith('deepwiki_') ||
            name.startsWith('sequential_thinking')
        ));

        // Derive source — for MCP tools, extract server prefix
        let source = 'builtin';
        if (isMcp) {
            const parts = name.split('_');
            // e.g., forkscout_memory_add_entity → forkscout-memory
            if (name.startsWith('forkscout_memory_')) source = 'forkscout-memory';
            else if (name.startsWith('context7_')) source = 'context7';
            else if (name.startsWith('deepwiki_')) source = 'deepwiki';
            else if (name.startsWith('sequential_thinking')) source = 'sequential-thinking';
            else source = parts[0];
        }

        const entry: ToolEntry = {
            name,
            description,
            parameters: extractParameters(toolDef),
            category: inferCategory(name),
            isMcp,
            source,
        };

        toolEntries.push(entry);
        searchableText.set(name, buildSearchableText(entry));
    }

    const categories = new Set(toolEntries.map(t => t.category));
    console.log(
        `[ToolIndex]: Indexed ${toolEntries.length} tools ` +
        `across ${categories.size} categories: ${[...categories].sort().join(', ')}`,
    );
}

// ── Search ─────────────────────────────────────────────

/**
 * Search the tool index by natural language query.
 *
 * Scoring:
 *   - Exact name match: +10
 *   - Category match: +5
 *   - Word in description: +3
 *   - Word in name: +2
 *   - Word in parameters: +1
 *   - Partial name segment match: +1.5
 */
export function searchTools(query: string, limit: number = 10): SearchResult[] {
    if (toolEntries.length === 0) {
        console.warn('[ToolIndex]: Index is empty — was buildToolIndex() called?');
        return [];
    }

    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

    if (queryWords.length === 0) return [];

    const results: SearchResult[] = [];

    for (const entry of toolEntries) {
        const combinedText = searchableText.get(entry.name) ?? '';
        let score = 0;
        const matchedOn: string[] = [];

        // ── Exact name match (highest priority) ──
        const normalizedName = entry.name.replace(/_/g, '');
        const normalizedQuery = queryLower.replace(/\s+/g, '');
        if (entry.name === queryLower || normalizedName === normalizedQuery) {
            score += 10;
            matchedOn.push('name-exact');
        }

        // ── Fast skip: if no query word appears anywhere, skip entirely ──
        if (score === 0 && !queryWords.some(w => combinedText.includes(w))) {
            continue;
        }

        // ── Category match ──
        if (entry.category === queryLower || queryWords.some(w => entry.category.includes(w))) {
            score += 5;
            matchedOn.push('category');
        }

        // ── Word-level matching ──
        const descLower = entry.description.toLowerCase();
        const nameLower = entry.name.toLowerCase();

        for (const word of queryWords) {
            // Description match (strongest signal after name)
            if (descLower.includes(word)) {
                score += 3;
                if (!matchedOn.includes('description')) matchedOn.push('description');
            }

            // Name contains word
            if (nameLower.includes(word)) {
                score += 2;
                if (!matchedOn.includes('name')) matchedOn.push('name');
            }

            // Parameter name/description match
            for (const p of entry.parameters) {
                if (p.name.toLowerCase().includes(word) || p.description.toLowerCase().includes(word)) {
                    score += 1;
                    if (!matchedOn.includes('parameters')) matchedOn.push('parameters');
                    break; // count once per word
                }
            }
        }

        // ── Partial name segment match ──
        // "file" matches "read_file", "write_file", etc.
        const nameParts = entry.name.split('_');
        for (const word of queryWords) {
            if (nameParts.some(part => part.startsWith(word) || word.startsWith(part))) {
                score += 1.5;
                if (!matchedOn.includes('name-partial')) matchedOn.push('name-partial');
            }
        }

        if (score > 0) {
            results.push({ tool: entry, score, matchedOn });
        }
    }

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

// ── Category Queries ───────────────────────────────────

/**
 * Get all tools in a specific category.
 */
export function getToolsByCategory(category: string): ToolEntry[] {
    return toolEntries.filter(t => t.category === category);
}

/**
 * Get all categories and their tool counts.
 */
export function getCategories(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of toolEntries) {
        counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    }
    return counts;
}

// ── Single-Entry Lookup ────────────────────────────────

/**
 * Get a specific tool entry by exact name.
 */
export function getToolEntry(name: string): ToolEntry | undefined {
    return toolEntries.find(t => t.name === name);
}

/**
 * Get the full index (for debugging/diagnostics).
 */
export function getAllToolEntries(): readonly ToolEntry[] {
    return toolEntries;
}

/**
 * Get current index size.
 */
export function getIndexSize(): number {
    return toolEntries.length;
}

// ── LLM-Friendly Formatting ───────────────────────────

/**
 * Format search results as compact text for LLM consumption.
 * Designed to be token-efficient while giving the model enough
 * information to decide which tools to request.
 */
export function formatSearchResults(results: SearchResult[]): string {
    if (results.length === 0) return 'No tools found matching your query.';

    return results.map(({ tool: t, score }) => {
        const paramList = t.parameters.length > 0
            ? `\n  params: ${t.parameters.map(p => `${p.name}${p.required ? '' : '?'}`).join(', ')}`
            : '';
        // Truncate long descriptions to save tokens
        const desc = t.description.length > 200
            ? t.description.slice(0, 197) + '...'
            : t.description;
        return `• ${t.name} [${t.category}] (score: ${score.toFixed(1)})${paramList}\n  ${desc}`;
    }).join('\n\n');
}

/**
 * Format category summary — shows all categories and tool counts.
 * Helps the LLM understand what's available at a glance.
 */
export function formatCategorySummary(): string {
    const cats = getCategories();
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    return sorted.map(([cat, count]) => `${cat}: ${count} tools`).join('\n');
}
