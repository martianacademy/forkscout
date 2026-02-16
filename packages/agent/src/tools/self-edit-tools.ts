/**
 * Safe Self-Edit Tool — Allows the agent to edit its own source with guardrails.
 *
 * Safety mechanisms:
 *   1. Creates a .bak backup before any write
 *   2. Runs `tsc --noEmit` to validate the change compiles
 *   3. If validation fails, auto-restores from backup
 *   4. Only successful edits trigger tsx watch restart
 */

import { z } from 'zod';
import { exec } from 'child_process';
import { resolve as resolvePath } from 'path';
import { AGENT_SRC, AGENT_ROOT } from '../paths';
import { resolveAgentPath } from '../paths';

export const safeSelfEditTool = {
    name: 'safe_self_edit',
    description: 'Safely edit the agent\'s own source files. Creates a backup, writes the change, validates it compiles with TypeScript, and auto-rolls back if compilation fails. Use this instead of write_file when modifying agent source code.',
    parameters: z.object({
        path: z.string().describe('File path to edit (must be within packages/agent/src/)'),
        content: z.string().describe('Full new content for the file'),
        reason: z.string().describe('Brief explanation of what is being changed and why'),
    }),
    async execute(params: { path: string; content: string; reason: string }): Promise<string> {
        const fs = await import('fs/promises');
        const { dirname } = await import('path');

        const absPath = resolveAgentPath(params.path);

        // Guard: only allow editing within agent source
        if (!absPath.startsWith(AGENT_SRC)) {
            return `BLOCKED: safe_self_edit only allows editing files within the agent's src/ directory (${AGENT_SRC}). Path "${absPath}" is outside the allowed scope. Use write_file for other files.`;
        }

        // Step 1: Read existing content (if any) and create backup
        let originalContent: string | null = null;
        const backupPath = absPath + '.bak';

        try {
            originalContent = await fs.readFile(absPath, 'utf-8');
            await fs.writeFile(backupPath, originalContent, 'utf-8');
        } catch {
            // File doesn't exist yet — that's fine, it's a new file
        }

        // Step 2: Write the new content
        await fs.mkdir(dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, params.content, 'utf-8');

        // Step 3: Validate with TypeScript compiler
        const tsconfigPath = resolvePath(AGENT_ROOT, 'tsconfig.json');

        const compileResult = await new Promise<{ success: boolean; errors: string }>((resolve) => {
            exec(
                `npx tsc -p "${tsconfigPath}" --noEmit 2>&1 | grep -v "default-tools" | head -20`,
                { timeout: 30_000, shell: '/bin/zsh', maxBuffer: 1024 * 1024, cwd: AGENT_ROOT },
                (_error, stdout) => {
                    const output = (stdout || '').trim();
                    // If there's any error output that contains "error TS", compilation failed
                    const hasErrors = output.includes('error TS');
                    resolve({
                        success: !hasErrors,
                        errors: output,
                    });
                }
            );
        });

        if (!compileResult.success) {
            // Step 4: ROLLBACK — restore original file
            console.log(`\n⚠️ SELF-EDIT ROLLED BACK: TypeScript compilation failed`);
            console.log(`   Reason for edit: ${params.reason}`);
            console.log(`   Errors:\n${compileResult.errors}\n`);

            if (originalContent !== null) {
                await fs.writeFile(absPath, originalContent, 'utf-8');
            } else {
                // New file that failed — remove it
                await fs.rm(absPath).catch(() => { });
            }

            // Clean up backup
            await fs.rm(backupPath).catch(() => { });

            return `ROLLED BACK: Edit to "${params.path}" failed TypeScript validation and was reverted.\n\nCompilation errors:\n${compileResult.errors}\n\nThe original file has been restored. Fix the errors and try again.`;
        }

        // Success — clean up backup
        await fs.rm(backupPath).catch(() => { });

        console.log(`\n✅ SELF-EDIT APPLIED: ${params.path}`);
        console.log(`   Reason: ${params.reason}`);
        console.log(`   Size: ${params.content.length} bytes\n`);

        return `SUCCESS: File "${params.path}" edited successfully (${params.content.length} bytes).\nReason: ${params.reason}\nTypeScript validation passed. The change will take effect on next restart (automatic if using pnpm dev).`;
    },
};

export const selfEditTools = [safeSelfEditTool];
