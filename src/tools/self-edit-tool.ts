/**
 * Safe self-edit tool — lets the agent modify its own source with TypeScript validation.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { getShell } from '../utils/shell';
import { resolveAgentPath, AGENT_SRC, AGENT_ROOT } from '../paths';
import { logSelfEdit } from '../activity-log';

export const safeSelfEdit = tool({
    description: 'Safely edit the agent\'s own source files. Creates a backup, writes the change, validates it compiles with TypeScript, and auto-rolls back if compilation fails.',
    inputSchema: z.object({
        path: z.string().describe('File path to edit (must be within packages/agent/src/)'),
        content: z.string().describe('Full new content for the file'),
        reason: z.string().describe('Brief explanation of what is being changed and why'),
    }),
    execute: async ({ path, content, reason }) => {
        try {
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
                    `node_modules/.bin/tsc -p "${tsconfigPath}" --noEmit 2>&1 | head -20`,
                    { timeout: 30_000, shell: getShell(), maxBuffer: 1024 * 1024, cwd: AGENT_ROOT },
                    (_error: Error | null, stdout: string) => {
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
                logSelfEdit(path, reason, content.length, false);
                return `ROLLED BACK: Edit to "${path}" failed TypeScript validation.\n\nErrors:\n${compileResult.errors}`;
            }

            await fs.rm(backupPath).catch(() => { });
            console.log(`\n✅ SELF-EDIT APPLIED: ${path} — ${reason}`);
            logSelfEdit(path, reason, content.length, true);

            // Log the edit to .forkscout/edit-log.json
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
                if (log.length > 200) log = log.slice(-200);
                await fs.writeFile(editLogPath, JSON.stringify(log, null, 2), 'utf-8');
            } catch { /* non-critical, don't fail the edit */ }

            return `SUCCESS: File "${path}" edited (${content.length} bytes). Reason: ${reason}. TypeScript passed.`;
        } catch (err) {
            return `❌ safe_self_edit failed: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
});
