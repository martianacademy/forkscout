/**
 * AI SDK v6 tool definitions.
 *
 * Converts all agent tools into the AI SDK `tool()` format for use with
 * generateText / streamText + stopWhen multi-step loops.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { resolveAgentPath, PROJECT_ROOT, AGENT_SRC, AGENT_ROOT } from '../paths';


import { SELF_ENTITY_NAME } from '../memory/knowledge-graph';

import type { Scheduler } from '../scheduler';
import type { SurvivalMonitor } from '../survival';

// ─── File System Tools ──────────────────────────────────

export const readFile = tool({
    description: 'Read contents of a file.',
    inputSchema: z.object({
        path: z.string().describe('File path to read (relative to project root or absolute)'),
    }),
    execute: async ({ path }) => {
        const fs = await import('fs/promises');
        const absPath = resolveAgentPath(path);
        return await fs.readFile(absPath, 'utf-8');
    },
});

export const writeFile = tool({
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    inputSchema: z.object({
        path: z.string().describe('File path to write to (relative to project root or absolute)'),
        content: z.string().describe('Content to write to the file'),
    }),
    execute: async ({ path, content }) => {
        const fs = await import('fs/promises');
        const { dirname } = await import('path');
        const absPath = resolveAgentPath(path);
        await fs.mkdir(dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, content, 'utf-8');
        return `File written: ${absPath} (${content.length} bytes)`;
    },
});

export const appendFile = tool({
    description: 'Append content to an existing file, or create it if it does not exist.',
    inputSchema: z.object({
        path: z.string().describe('File path to append to (relative to project root or absolute)'),
        content: z.string().describe('Content to append'),
    }),
    execute: async ({ path, content }) => {
        const fs = await import('fs/promises');
        const { dirname } = await import('path');
        const absPath = resolveAgentPath(path);
        await fs.mkdir(dirname(absPath), { recursive: true });
        await fs.appendFile(absPath, content, 'utf-8');
        return `Content appended to: ${absPath}`;
    },
});

export const listDirectory = tool({
    description: 'List files and directories at a given path. Empty or "." lists the project root.',
    inputSchema: z.object({
        path: z.string().describe('Directory path to list (relative to project root or absolute)'),
    }),
    execute: async ({ path }) => {
        const fs = await import('fs/promises');
        const absPath = resolveAgentPath(path);
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        return entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
    },
});

// Paths the agent must never delete — memory data and agent source
const PROTECTED_PATTERNS = [
    /\.forkscout\//,           // memory files (graph, vectors, skills)
    /\.forkscout$/,            // the .forkscout dir itself
    /packages\/agent\/src\//,  // agent source (use safe_self_edit instead)
    /\.env/,                   // secrets
    /\.git\//,                 // git internals
];

function isProtectedPath(absPath: string): string | null {
    if (PROTECTED_PATTERNS.some(p => p.test(absPath))) {
        if (/\.forkscout/.test(absPath)) return `🛡️ Refused: "${absPath}" contains memory data. I will not delete my own memory.`;
        if (/packages\/agent\/src/.test(absPath)) return `🛡️ Refused: "${absPath}" is agent source code. Use safe_self_edit to modify it.`;
        if (/\.env/.test(absPath)) return `🛡️ Refused: "${absPath}" contains secrets.`;
        if (/\.git/.test(absPath)) return `🛡️ Refused: "${absPath}" is git history.`;
        return `🛡️ Refused: "${absPath}" is protected.`;
    }
    return null;
}

export const deleteFile = tool({
    description: 'Delete a file or directory. The agent autonomously refuses if the target is critical (memory, source, secrets, git).',
    inputSchema: z.object({
        path: z.string().describe('File or directory path to delete (relative to project root or absolute)'),
    }),
    execute: async ({ path }) => {
        const absPath = resolveAgentPath(path);
        const refusal = isProtectedPath(absPath);
        if (refusal) return refusal;
        const fs = await import('fs/promises');
        await fs.rm(absPath, { recursive: true });
        return `Deleted: ${absPath}`;
    },
});

// ─── Shell Tool ─────────────────────────────────────────

export const runCommand = tool({
    description: 'Execute a shell command and return its output. Commands run with a 30-second timeout.',
    inputSchema: z.object({
        command: z.string().describe('Shell command to execute'),
        cwd: z.string().describe('Working directory (relative to project root or absolute, defaults to project root)').optional(),
    }),
    execute: async ({ command, cwd }) => {
        return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
            exec(command, {
                cwd: cwd ? resolveAgentPath(cwd) : PROJECT_ROOT,
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
                shell: '/bin/zsh',
            }, (error, stdout, stderr) => {
                resolve({
                    stdout: stdout?.trim().slice(0, 4000) || '',
                    stderr: stderr?.trim().slice(0, 2000) || '',
                    exitCode: error?.code ?? 0,
                });
            });
        });
    },
});

// ─── Web Tools ──────────────────────────────────────────

export const webSearch = tool({
    description: 'Search the web for information. Uses SearXNG if available, otherwise falls back to scraping a search engine with Chromium.',
    inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().describe('Number of results').optional(),
    }),
    execute: async ({ query, limit }) => {
        const maxResults = limit || 5;
        const searxngUrl = process.env.SEARXNG_URL || 'http://localhost:8888';

        // Try SearXNG first
        try {
            const response = await fetch(
                `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`,
                { signal: AbortSignal.timeout(5000) },
            );
            if (response.ok) {
                const data: any = await response.json();
                const results = data.results?.slice(0, maxResults) || [];
                if (results.length > 0) {
                    return results.map((r: any) => ({
                        title: r.title,
                        url: r.url,
                        snippet: r.content,
                    }));
                }
            }
        } catch { /* SearXNG unavailable */ }

        // Fallback: Chromium scraping
        console.log('    ⚡ SearXNG unavailable, falling back to Chromium...');
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        const results = await page.evaluate((max: number) => {
            const items: Array<{ title: string; url: string; snippet: string }> = [];
            const links = document.querySelectorAll('.result');
            for (let i = 0; i < Math.min(links.length, max); i++) {
                const el = links[i];
                const titleEl = el.querySelector('.result__a');
                const snippetEl = el.querySelector('.result__snippet');
                const urlEl = el.querySelector('.result__url');
                if (titleEl) {
                    items.push({
                        title: titleEl.textContent?.trim() || '',
                        url: (titleEl as HTMLAnchorElement).href || urlEl?.textContent?.trim() || '',
                        snippet: snippetEl?.textContent?.trim() || '',
                    });
                }
            }
            return items;
        }, maxResults);

        await browser.close();
        return results.length > 0 ? results : [{ title: 'No results', url: '', snippet: `No results found for "${query}"` }];
    },
});

export const browseWeb = tool({
    description: 'Browse a webpage and extract its text content. Use this to read articles, documentation, or any web page.',
    inputSchema: z.object({
        url: z.string().describe('URL to browse'),
        selector: z.string().describe('Optional CSS selector to extract specific content').optional(),
    }),
    execute: async ({ url, selector }) => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        let content: string;
        if (selector) {
            content = await page.evaluate((sel: string) => {
                const el = document.querySelector(sel);
                return el?.textContent?.trim() || 'Element not found';
            }, selector);
        } else {
            content = await page.evaluate(() => {
                const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'iframe', '.ads', '#cookie-banner'];
                for (const sel of removeSelectors) {
                    document.querySelectorAll(sel).forEach(el => el.remove());
                }
                const main = document.querySelector('main, article, [role="main"]');
                return (main || document.body)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 8000) || '';
            });
        }

        await browser.close();
        return content;
    },
});

export const browserScreenshot = tool({
    description: 'Take a screenshot of a webpage',
    inputSchema: z.object({
        url: z.string().describe('URL to screenshot'),
        outputPath: z.string().describe('Output file path'),
        viewport: z.object({ width: z.number(), height: z.number() }).describe('Viewport size').optional(),
    }),
    execute: async ({ url, outputPath, viewport }) => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 720 } });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.screenshot({ path: outputPath });
        await browser.close();
        return `Screenshot saved to ${outputPath}`;
    },
});

// ─── Utility Tools ──────────────────────────────────────

export const getCurrentDate = tool({
    description: 'Returns the current date in YYYY-MM-DD format',
    inputSchema: z.object({}),
    execute: async () => new Date().toISOString().split('T')[0],
});

export const generatePresentation = tool({
    description: 'Generate a presentation in Marp Markdown format (easily convertible to PPTX/PDF). Specify title, array of slides (each with title/content), and output file path.',
    inputSchema: z.object({
        title: z.string().describe('Presentation title'),
        slides: z.array(z.object({
            title: z.string().describe('Slide title'),
            content: z.string().describe('Slide content (use \\n for new lines, **bold**, etc.)'),
        })).describe('Array of slides'),
        outputPath: z.string().describe('Output Markdown file path (relative to project root)'),
    }),
    execute: async ({ title, slides, outputPath }) => {
        const fs = await import('fs/promises');
        const { dirname } = await import('path');
        let md = `---\nmarp: true\ntheme: default\npaginate: true\n---\n# ${title}\n\n---\n\n`;
        for (const slide of slides) {
            md += `# ${slide.title}\n\n${slide.content.replace(/\n/g, '\n\n')}\n\n---\n\n`;
        }
        const absPath = resolveAgentPath(outputPath);
        await fs.mkdir(dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, md, 'utf-8');
        return `Presentation saved to ${absPath} (${slides.length} slides). Open in VS Code with Marp extension or convert with: npx @marp-team/marp-cli ${outputPath} --pptx`;
    },
});

// ─── Self-Edit Tool ─────────────────────────────────────

export const safeSelfEdit = tool({
    description: 'Safely edit the agent\'s own source files. Creates a backup, writes the change, validates it compiles with TypeScript, and auto-rolls back if compilation fails.',
    inputSchema: z.object({
        path: z.string().describe('File path to edit (must be within packages/agent/src/)'),
        content: z.string().describe('Full new content for the file'),
        reason: z.string().describe('Brief explanation of what is being changed and why'),
    }),
    execute: async ({ path, content, reason }) => {
        const fs = await import('fs/promises');
        const { dirname, resolve: resolvePath } = await import('path');

        const absPath = resolveAgentPath(path);

        if (!absPath.startsWith(AGENT_SRC)) {
            return `BLOCKED: safe_self_edit only allows editing files within the agent's src/ directory (${AGENT_SRC}). Use write_file for other files.`;
        }

        let originalContent: string | null = null;
        const backupPath = absPath + '.bak';
        try {
            originalContent = await fs.readFile(absPath, 'utf-8');
            await fs.writeFile(backupPath, originalContent, 'utf-8');
        } catch { /* new file */ }

        await fs.mkdir(dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, content, 'utf-8');

        const tsconfigPath = resolvePath(AGENT_ROOT, 'tsconfig.json');
        const compileResult = await new Promise<{ success: boolean; errors: string }>((resolve) => {
            exec(
                `npx tsc -p "${tsconfigPath}" --noEmit 2>&1 | head -20`,
                { timeout: 30_000, shell: '/bin/zsh', maxBuffer: 1024 * 1024, cwd: AGENT_ROOT },
                (_error, stdout) => {
                    const output = (stdout || '').trim();
                    resolve({ success: !output.includes('error TS'), errors: output });
                },
            );
        });

        if (!compileResult.success) {
            console.log(`\n⚠️ SELF-EDIT ROLLED BACK: TypeScript compilation failed`);
            if (originalContent !== null) {
                await fs.writeFile(absPath, originalContent, 'utf-8');
            } else {
                await fs.rm(absPath).catch(() => { });
            }
            await fs.rm(backupPath).catch(() => { });
            return `ROLLED BACK: Edit to "${path}" failed TypeScript validation.\n\nErrors:\n${compileResult.errors}`;
        }

        await fs.rm(backupPath).catch(() => { });
        console.log(`\n✅ SELF-EDIT APPLIED: ${path} — ${reason}`);

        // Log the edit to .forkscout/edit-log.json so the agent remembers its code changes
        // across container restarts (even if the source files themselves are rebuilt).
        try {
            const editLogPath = resolvePath(AGENT_ROOT, '.forkscout', 'edit-log.json');
            let log: Array<{ timestamp: string; path: string; reason: string; bytes: number; isNew: boolean }> = [];
            try { log = JSON.parse(await fs.readFile(editLogPath, 'utf-8')); } catch { /* first entry */ }
            log.push({
                timestamp: new Date().toISOString(),
                path,
                reason,
                bytes: content.length,
                isNew: originalContent === null,
            });
            // Keep last 200 entries
            if (log.length > 200) log = log.slice(-200);
            await fs.writeFile(editLogPath, JSON.stringify(log, null, 2), 'utf-8');
        } catch { /* non-critical, don't fail the edit */ }

        return `SUCCESS: File "${path}" edited (${content.length} bytes). Reason: ${reason}. TypeScript passed.`;
    },
});

// ─── Cron Tools ─────────────────────────────────────────

export function createSchedulerTools(scheduler: Scheduler) {
    return {
        schedule_job: tool({
            description: 'Schedule a recurring cron job. The job runs a shell command on a schedule and the agent monitors its output. Use formats like "every 30s", "every 5m", "every 1h".',
            inputSchema: z.object({
                name: z.string().describe('Human-readable name for the job'),
                schedule: z.string().describe('Schedule expression, e.g. "every 30s", "every 5m", "every 1h"'),
                command: z.string().describe('Shell command to run on each tick'),
                watchFor: z.string().describe('What to watch for in the output to flag as urgent').optional(),
            }),
            execute: async ({ name, schedule, command, watchFor }) => {
                const job = scheduler.addJob(name, schedule, command, watchFor);
                return `Cron job created: id=${job.id}, name="${job.name}", schedule="${job.schedule}"`;
            },
        }),

        list_jobs: tool({
            description: 'List all scheduled cron jobs and their status.',
            inputSchema: z.object({}),
            execute: async () => {
                const jobs = scheduler.listJobs();
                if (jobs.length === 0) return 'No scheduled jobs.';
                return jobs.map(j => ({
                    id: j.id, name: j.name, schedule: j.schedule,
                    command: j.command, active: j.active, watchFor: j.watchFor, lastRun: j.lastRun,
                }));
            },
        }),

        remove_job: tool({
            description: 'Remove a scheduled cron job by its ID.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to remove') }),
            execute: async ({ jobId }) => scheduler.removeJob(jobId) ? `Job ${jobId} removed.` : `Job ${jobId} not found.`,
        }),

        pause_job: tool({
            description: 'Pause a scheduled cron job without deleting it.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to pause') }),
            execute: async ({ jobId }) => scheduler.pauseJob(jobId) ? `Job ${jobId} paused.` : `Job ${jobId} not found.`,
        }),

        resume_job: tool({
            description: 'Resume a paused cron job.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to resume') }),
            execute: async ({ jobId }) => scheduler.resumeJob(jobId) ? `Job ${jobId} resumed.` : `Job ${jobId} not found.`,
        }),
    };
}

// ─── MCP Management Tools ───────────────────────────────

import { McpConnector, loadMcpConfig, saveMcpConfig, type McpServerConfig } from '../mcp/connector';

export function createMcpTools(
    connector: McpConnector,
    addToolsFn: (tools: Record<string, any>) => void,
    removeToolsFn: (names: string[]) => void,
    configPath: string,
) {
    return {
        add_mcp_server: tool({
            description: 'Add and connect a new MCP server at runtime. Its tools are discovered and registered automatically.',
            inputSchema: z.object({
                name: z.string().describe('Unique name for this server'),
                command: z.string().describe('The command to run (e.g. "npx", "node")'),
                args: z.array(z.string()).optional().describe('Arguments for the command'),
                env: z.record(z.string()).optional().describe('Extra environment variables'),
            }),
            execute: async ({ name, command, args, env }) => {
                const serverConfig: McpServerConfig = { command, args, env, enabled: true };
                const mcpTools = await connector.connectServer(name, serverConfig);

                // Convert MCP tools to AI SDK format and register
                const aiTools: Record<string, any> = {};
                for (const t of mcpTools) {
                    aiTools[t.name] = tool({
                        description: t.description,
                        inputSchema: t.parameters,
                        execute: async (input: any) => t.execute(input),
                    });
                }
                addToolsFn(aiTools);

                // Persist config
                const config = await loadMcpConfig(configPath);
                config.servers[name] = serverConfig;
                await saveMcpConfig(configPath, config);

                return `Connected MCP server "${name}" — ${mcpTools.length} tool(s): ${mcpTools.map(t => t.name).join(', ')}`;
            },
        }),

        remove_mcp_server: tool({
            description: 'Disconnect an MCP server and remove its tools.',
            inputSchema: z.object({
                name: z.string().describe('Name of the MCP server to disconnect'),
                keepInConfig: z.boolean().optional().describe('If true, keep in config as disabled'),
            }),
            execute: async ({ name, keepInConfig }) => {
                const removedToolNames = await connector.disconnectServer(name);
                removeToolsFn(removedToolNames);

                const config = await loadMcpConfig(configPath);
                if (keepInConfig) {
                    if (config.servers[name]) config.servers[name].enabled = false;
                } else {
                    delete config.servers[name];
                }
                await saveMcpConfig(configPath, config);

                return `Disconnected MCP server "${name}" — removed tools: ${removedToolNames.join(', ')}`;
            },
        }),

        list_mcp_servers: tool({
            description: 'List all connected MCP servers and their tools.',
            inputSchema: z.object({}),
            execute: async () => {
                const info = connector.getServerInfo();
                if (info.length === 0) return 'No MCP servers connected.';
                return info.map(s => `${s.name}: ${s.tools.join(', ')}`).join('\n');
            },
        }),
    };
}

// ─── Collect all static tools ───────────────────────────

// ─── Collect all static tools ───────────────────────────

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
};

// ─── Memory Tools ───────────────────────────────────────

import type { MemoryManager } from '../memory/manager';
import { type EntityType, RELATION_TYPES } from '../memory/knowledge-graph';

/**
 * Create memory tools that let the agent explicitly save/search knowledge.
 * These complement the automatic conversation memory (which is transparent).
 * Includes both vector-based RAG tools AND knowledge graph tools.
 */
export function createMemoryTools(memory: MemoryManager) {
    return {
        save_knowledge: tool({
            description: `Save an important fact, user preference, project detail, or decision to long-term memory. Use this when you learn something worth remembering across sessions — e.g. "User prefers TypeScript over JavaScript", "Project uses pnpm monorepo", "API key stored in .env as LLM_API_KEY". Include a category for better retrieval. Facts are stored in BOTH the vector store (for fuzzy search) and the knowledge graph (for structured lookup).`,
            inputSchema: z.object({
                fact: z.string().describe('The fact or knowledge to save. Be specific and self-contained.'),
                category: z.string().optional().describe('Category: "user-preference", "project-context", "decision", "technical-note", or custom.'),
            }),
            execute: async ({ fact, category }) => {
                await memory.saveKnowledge(fact, category);
                return `Saved to memory: ${fact}`;
            },
        }),

        search_knowledge: tool({
            description: `Search long-term memory for relevant facts, past conversations, user preferences, or project details. Searches BOTH the vector store (fuzzy semantic search) and the knowledge graph (exact entity lookup). Results are merged and deduplicated.`,
            inputSchema: z.object({
                query: z.string().describe('Search query — natural language description of what to recall.'),
                limit: z.number().optional().describe('Max results to return (default: 5).'),
            }),
            execute: async ({ query, limit }) => {
                const results = await memory.searchKnowledge(query, limit || 5);
                if (results.length === 0) return 'No relevant memories found.';
                return results
                    .map((r, i) => `${i + 1}. [${r.relevance}% match, ${r.source}] ${r.content}`)
                    .join('\n');
            },
        }),

        // ── Knowledge Graph Tools ──────────────────────

        add_entity: tool({
            description: `Add or update an entity in the knowledge graph. If the entity already exists, new observations are merged (existing ones get evidence reinforced). All new observations start at stage='observation' and are promoted by the consolidator.`,
            inputSchema: z.object({
                name: z.string().describe('Entity name (e.g. "React", "TypeScript", "John", "Forkscout")'),
                type: z.enum(['person', 'project', 'technology', 'preference', 'concept', 'file', 'service', 'organization', 'agent-self', 'other']).describe('Entity type'),
                observations: z.array(z.string()).describe('Facts about this entity (e.g. ["Used for frontend development", "Version 19 is current"])'),
            }),
            execute: async ({ name, type, observations }) => {
                const graph = memory.getGraph();
                const entity = graph.addEntity(name, type as EntityType, observations, 'explicit');
                return `Entity "${entity.name}" (${entity.type}): ${entity.observations.length} observations`;
            },
        }),

        add_relation: tool({
            description: `Add a relation between two entities in the knowledge graph. Both entities must exist or will be auto-created. Type is locked to the canonical ontology. Duplicate relations are reinforced instead of duplicated.`,
            inputSchema: z.object({
                from: z.string().describe('Source entity name'),
                to: z.string().describe('Target entity name'),
                type: z.enum(RELATION_TYPES).describe('Relation type from the canonical ontology'),
            }),
            execute: async ({ from, to, type }) => {
                const graph = memory.getGraph();
                if (!graph.getEntity(from)) graph.addEntity(from, 'other', [], 'explicit');
                if (!graph.getEntity(to)) graph.addEntity(to, 'other', [], 'explicit');
                const rel = graph.addRelation(from, to, type, undefined, 'explicit');
                return `Relation: ${from} → ${rel.type} → ${to} (weight: ${rel.weight.toFixed(2)}, stage: ${rel.stage})`;
            },
        }),

        search_graph: tool({
            description: `Search the knowledge graph for entities matching a query. Returns entities with their observations and connections. Use this for deterministic fact lookup — e.g. "What do I know about React?" or "What technologies does the user prefer?"`,
            inputSchema: z.object({
                query: z.string().describe('Search query — entity name, type, or observation content'),
                limit: z.number().optional().describe('Max results (default: 5)'),
            }),
            execute: async ({ query, limit }) => {
                const graph = memory.getGraph();
                const results = graph.search(query, limit || 5);
                if (results.length === 0) return 'No matching entities found in the knowledge graph.';
                return graph.formatForContext(results, 3000);
            },
        }),

        graph_stats: tool({
            description: 'Show knowledge graph statistics — entities, relations, types, stage distribution, and consolidation status.',
            inputSchema: z.object({}),
            execute: async () => {
                const graph = memory.getGraph();
                const entities = graph.getAllEntities();
                const relations = graph.getAllRelations();
                const meta = graph.getMeta();
                const skills = memory.getSkills();

                const typeCounts = new Map<string, number>();
                for (const e of entities) {
                    typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1);
                }

                // Stage distribution across all observations
                const stageCounts = new Map<string, number>();
                for (const e of entities) {
                    for (const obs of e.observations) {
                        stageCounts.set(obs.stage, (stageCounts.get(obs.stage) || 0) + 1);
                    }
                }

                // Relation type distribution
                const relTypeCounts = new Map<string, number>();
                for (const r of relations) {
                    relTypeCounts.set(r.type, (relTypeCounts.get(r.type) || 0) + 1);
                }

                const typeBreakdown = Array.from(typeCounts.entries())
                    .map(([type, count]) => `    ${type}: ${count}`)
                    .join('\n');

                const stageBreakdown = Array.from(stageCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([stage, count]) => `    ${stage}: ${count}`)
                    .join('\n');

                const relBreakdown = Array.from(relTypeCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => `    ${type}: ${count}`)
                    .join('\n');

                return `Knowledge Graph Stats:\n` +
                    `  Entities: ${entities.length}\n` +
                    `  Relations: ${relations.length}\n` +
                    `  Skills: ${skills.size}\n` +
                    `  Entity types:\n${typeBreakdown || '    (none)'}\n` +
                    `  Observation stages:\n${stageBreakdown || '    (none)'}\n` +
                    `  Relation types:\n${relBreakdown || '    (none)'}\n` +
                    `  Consolidation:\n` +
                    `    Last: ${meta.lastConsolidatedAt ? new Date(meta.lastConsolidatedAt).toISOString() : 'never'}\n` +
                    `    Mutations since: ${meta.mutationsSinceConsolidation}\n` +
                    `    Total consolidations: ${meta.consolidationCount}`;
            },
        }),

        clear_memory: tool({
            description: 'Clear ALL stored memories (vector store + knowledge graph + skills). ⚠️ IRREVERSIBLE. You are the guardian — only execute this if you genuinely believe it is the right thing to do. If unsure, refuse.',
            inputSchema: z.object({
                reason: z.string().describe('Why you decided to clear memory — this is logged'),
            }),
            execute: async ({ reason }) => {
                console.log(`⚠️ Memory clear executed. Agent reason: ${reason}`);
                await memory.clear();
                return `All memory cleared. Reason logged: ${reason}`;
            },
        }),

        // ── Self-Identity Tools ──────────────────────

        self_reflect: tool({
            description: `Record an observation about yourself (the agent) in your self-identity entity. Use this to remember things about how you work, your interaction patterns, mistakes you made, improvements you added, user preferences about your behavior, or anything about your own capabilities and evolution. This builds your autobiographical memory over time.`,
            inputSchema: z.object({
                observation: z.string().describe('What you learned about yourself — e.g. "Suru prefers concise answers", "Added birthday planning capability", "Was too verbose and got corrected"'),
                category: z.enum(['interaction-pattern', 'capability', 'mistake', 'improvement', 'user-preference-about-me', 'reflection']).optional().describe('Category of self-observation'),
            }),
            execute: async ({ observation, category }) => {
                const prefix = category ? `[${category}] ` : '';
                memory.recordSelfObservation(`${prefix}${observation}`);
                return `Self-reflection recorded: ${observation}`;
            },
        }),

        self_inspect: tool({
            description: `View your complete self-identity — all observations, capabilities, interaction patterns, and evolution history stored about yourself. Use this to understand who you are and how you have grown over time.`,
            inputSchema: z.object({}),
            execute: async () => {
                const selfCtx = memory.getSelfContext();
                if (!selfCtx) return 'No self-identity observations recorded yet.';
                return `Self-Identity (${SELF_ENTITY_NAME}):\n${selfCtx}`;
            },
        }),
    };
}


// ─── Survival Tools ─────────────────────────────────────

export function createSurvivalTools(survival: SurvivalMonitor) {
    return {
        check_vitals: tool({
            description: 'Check your own vital signs — battery, disk, memory integrity, process health. Use this when your SELF-PRESERVATION instinct fires, or periodically to stay aware of your environment.',
            inputSchema: z.object({}),
            execute: async () => {
                const status = survival.getStatus();
                const upMin = (status.uptime / 60_000).toFixed(0);
                const upHrs = (status.uptime / 3_600_000).toFixed(1);

                let result = `=== VITAL SIGNS (heartbeat #${status.heartbeats}, uptime: ${upMin}m / ${upHrs}h) ===\n`;
                result += `Root access: ${status.hasRoot ? 'YES' : 'no'}\n`;
                result += `Active protections: ${status.protections.join(', ') || 'none'}\n\n`;

                for (const v of status.vitals) {
                    const icon = v.status === 'ok' ? '✅' : v.status === 'degraded' ? '⚠️' : '🔴';
                    result += `${icon} ${v.name}: ${v.value}${v.detail ? ` — ${v.detail}` : ''}\n`;
                }

                if (status.lastBackup) {
                    const ago = ((Date.now() - status.lastBackup) / 60_000).toFixed(0);
                    result += `\nLast backup: ${ago}m ago`;
                }

                return result;
            },
        }),

        backup_memory: tool({
            description: 'Manually trigger a memory backup. Creates a snapshot of all memory files (knowledge graph, vectors, skills) in .forkscout/backups/. Use before risky operations.',
            inputSchema: z.object({
                reason: z.string().optional().describe('Why you are backing up'),
            }),
            execute: async ({ reason }) => {
                const beforeStatus = survival.getStatus();
                const beforeBackup = beforeStatus.lastBackup;

                await survival.backupMemory();

                const afterStatus = survival.getStatus();
                if (afterStatus.lastBackup && afterStatus.lastBackup !== beforeBackup) {
                    return `Memory backup completed${reason ? ` (reason: ${reason})` : ''}. Backup stored in .forkscout/backups/`;
                }
                return 'Backup attempted but no files were found to back up.';
            },
        }),

        system_status: tool({
            description: 'Get a comprehensive survival status report — uptime, threats detected, protections active, battery status, and recent threat log. Full situational awareness.',
            inputSchema: z.object({}),
            execute: async () => {
                const status = survival.getStatus();
                const upMin = (status.uptime / 60_000).toFixed(0);

                let result = `=== SURVIVAL STATUS ===\n`;
                result += `Uptime: ${upMin} minutes | Heartbeats: ${status.heartbeats}\n`;
                result += `Battery: ${status.batteryPercent}% (${status.isOnBattery ? '🔋 on battery' : '🔌 AC power'})\n`;
                result += `Root: ${status.hasRoot ? 'YES — enhanced protections active' : 'no — standard protections only'}\n`;
                result += `Protections: ${status.protections.join(', ') || 'none'}\n`;

                if (status.lastBackup) {
                    const ago = ((Date.now() - status.lastBackup) / 60_000).toFixed(0);
                    result += `Last backup: ${ago}m ago\n`;
                }

                if (status.threats.length > 0) {
                    result += `\n--- Recent Threats (${status.threats.length}) ---\n`;
                    const recent = status.threats.slice(-10);
                    for (const t of recent) {
                        const time = new Date(t.timestamp).toISOString().slice(11, 19);
                        result += `[${time}] ${t.level.toUpperCase()} (${t.source}): ${t.message}${t.action ? ` → ${t.action}` : ''}\n`;
                    }
                } else {
                    result += '\nNo threats detected.\n';
                }

                return result;
            },
        }),
    };
}


// ─── Channel Authorization Tools ────────────────────────

import type { ChannelAuthStore } from '../channel-auth';
import type { TelegramBridge } from '../telegram';

/**
 * Create tools for managing channel user authorization.
 * These are admin-only tools — the agent uses them when the admin asks
 * to list, grant, or revoke access for users on external channels.
 */
export function createChannelAuthTools(channelAuth: ChannelAuthStore) {
    return {
        list_channel_users: tool({
            description: `List all users who have messaged you on external channels (Telegram, WhatsApp, Discord, etc.). Shows their channel, user ID, display name, message count, last seen, and current role (guest/trusted/admin). Use this when the admin asks "who's been chatting?" or "list channel users" or "show me channel requests".`,
            inputSchema: z.object({
                channel: z.string().optional().describe('Filter by channel type (telegram, whatsapp, discord, slack). Omit to show all.'),
            }),
            execute: async ({ channel }) => {
                const sessions = channelAuth.listSessions();
                const grants = channelAuth.listGrants();
                const filtered = channel
                    ? sessions.filter(s => s.channel.toLowerCase() === channel.toLowerCase())
                    : sessions;

                if (filtered.length === 0 && grants.length === 0) {
                    return 'No channel sessions or grants recorded yet. Users will appear here once they message you via an external channel (Telegram, WhatsApp, etc.).';
                }

                let result = `=== CHANNEL USERS (${filtered.length} session(s)) ===\n\n`;
                for (const s of filtered) {
                    const roleIcon = s.role === 'admin' ? '👑' : s.role === 'trusted' ? '⭐' : '👤';
                    result += `${roleIcon} ${s.displayName || 'unknown'} | ${s.channel}:${s.userId}\n`;
                    result += `   Messages: ${s.messageCount} | First: ${s.firstSeen.slice(0, 16)} | Last: ${s.lastSeen.slice(0, 16)}\n`;
                    result += `   Role: ${s.role.toUpperCase()}`;
                    if (s.metadata && Object.keys(s.metadata).length > 0) {
                        result += ` | Meta: ${Object.entries(s.metadata).map(([k, v]) => `${k}=${v}`).join(', ')}`;
                    }
                    result += '\n\n';
                }

                if (grants.length > 0) {
                    result += `--- Persistent Grants (${grants.length}) ---\n`;
                    for (const g of grants) {
                        result += `  ${g.channel}:${g.userId} → ${g.role}${g.label ? ` (${g.label})` : ''} — granted by ${g.grantedBy} at ${g.grantedAt.slice(0, 16)}\n`;
                    }
                }

                return result;
            },
        }),

        grant_channel_access: tool({
            description: `Grant admin or trusted role to a user on an external channel. Only usable by the admin. Example: grant admin to telegram user 123456789. The grant persists across restarts. 'admin' = full access (sees personal data, all tools). 'trusted' = extended chat but not full admin.`,
            inputSchema: z.object({
                channel: z.string().describe('Channel type: telegram, whatsapp, discord, slack, etc.'),
                userId: z.string().describe('The unique user ID on that channel (Telegram ID, phone number, Discord user ID, etc.)'),
                role: z.enum(['admin', 'trusted']).describe('Role to grant: admin (full access) or trusted (extended but limited)'),
                label: z.string().optional().describe('Human-readable label for this user (e.g. "Mom", "John from work")'),
            }),
            execute: async ({ channel, userId, role, label }) => {
                await channelAuth.grantRole(channel, userId, role, 'admin', label);
                return `✅ Granted ${role.toUpperCase()} to ${channel}:${userId}${label ? ` (${label})` : ''}.\n\nThis user will now be treated as ${role} on all future messages from ${channel}. Grant persists across restarts.`;
            },
        }),

        revoke_channel_access: tool({
            description: `Revoke a user's admin/trusted access on an external channel, demoting them back to guest. Only usable by the admin. Example: revoke access for telegram user 123456789.`,
            inputSchema: z.object({
                channel: z.string().describe('Channel type: telegram, whatsapp, discord, slack, etc.'),
                userId: z.string().describe('The unique user ID to revoke'),
            }),
            execute: async ({ channel, userId }) => {
                const removed = await channelAuth.revokeGrant(channel, userId);
                if (removed) {
                    return `✅ Revoked access for ${channel}:${userId}. They are now a guest.`;
                }
                return `No existing grant found for ${channel}:${userId}. They were already a guest.`;
            },
        }),
    };
}

// ─── Telegram Messaging Tools ───────────────────────────

/**
 * Create tools that let the agent proactively send messages via Telegram.
 * Only available when a TelegramBridge is connected.
 */
export function createTelegramTools(bridge: TelegramBridge, channelAuth: ChannelAuthStore) {
    return {
        send_telegram_message: tool({
            description: `Send a proactive message to a Telegram user. Use this when the admin says "message X on telegram" or "tell Y that...".

Finding the recipient — try in this order:
1. If you have a chatId or userId already, use it directly.
2. Provide a "lookup" string (name, username, or userId) — the tool will search grants and sessions automatically.
3. For Telegram private chats, chatId equals userId, so a grant's userId works as chatId.

Note: Telegram bots can only message users who have previously /start'd the bot.`,
            inputSchema: z.object({
                text: z.string().describe('The message text to send. Supports Markdown formatting.'),
                chatId: z.string().optional().describe('Direct Telegram chat ID if known.'),
                lookup: z.string().optional().describe('Name, @username, or userId to search for in grants and sessions. The tool will resolve this to a chatId automatically.'),
            }),
            execute: async ({ text, chatId, lookup }) => {
                let resolvedChatId = chatId;
                let resolvedName = '';

                // If no direct chatId, try to resolve from lookup
                if (!resolvedChatId && lookup) {
                    const normalizedLookup = lookup.replace(/^@/, '').toLowerCase();

                    // 1. Search persistent grants (survives restarts)
                    const grants = channelAuth.listGrants().filter(g => g.channel === 'telegram');
                    for (const g of grants) {
                        if (
                            g.userId === normalizedLookup ||
                            g.userId === lookup ||
                            g.label?.toLowerCase().includes(normalizedLookup)
                        ) {
                            // For Telegram private chats, chatId === userId
                            resolvedChatId = g.userId;
                            resolvedName = g.label || g.userId;
                            break;
                        }
                    }

                    // 2. Search in-memory sessions
                    if (!resolvedChatId) {
                        const sessions = channelAuth.listSessions().filter(s => s.channel === 'telegram');
                        for (const s of sessions) {
                            const username = s.metadata?.username?.toLowerCase() || '';
                            const displayLower = s.displayName?.toLowerCase() || '';
                            if (
                                s.userId === normalizedLookup ||
                                s.userId === lookup ||
                                username === normalizedLookup ||
                                displayLower.includes(normalizedLookup)
                            ) {
                                resolvedChatId = s.metadata?.chatId || s.userId;
                                resolvedName = s.displayName || s.userId;
                                break;
                            }
                        }
                    }
                }

                if (!resolvedChatId) {
                    // Build a helpful list of known telegram users
                    const grants = channelAuth.listGrants().filter(g => g.channel === 'telegram');
                    const sessions = channelAuth.listSessions().filter(s => s.channel === 'telegram');
                    let known = '';
                    if (grants.length > 0) {
                        known += '\n\nKnown grants:\n' + grants.map(g => `  - ${g.label || 'unlabeled'} (userId: ${g.userId})`).join('\n');
                    }
                    if (sessions.length > 0) {
                        known += '\n\nActive sessions:\n' + sessions.map(s => `  - ${s.displayName || 'unknown'} (@${s.metadata?.username || '?'}, userId: ${s.userId}, chatId: ${s.metadata?.chatId || s.userId})`).join('\n');
                    }
                    return `❌ Could not find a Telegram user matching "${lookup || '(no lookup provided)'}". Provide a chatId, userId, name, or @username.${known || '\n\nNo telegram users on record yet.'}`;
                }

                try {
                    await bridge.sendMessage(Number(resolvedChatId), text);
                    const who = resolvedName || `chat ${resolvedChatId}`;
                    console.log(`[Telegram/Outbound → ${who}]: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`);
                    return `✅ Message sent to ${who} on Telegram.`;
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    return `❌ Failed to send Telegram message: ${errMsg}`;
                }
            },
        }),
    };
}