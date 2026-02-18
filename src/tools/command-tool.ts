/**
 * Shell command tool — execute commands with secret scrubbing.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { exec, type ExecException } from 'child_process';
import { getShell, unescapeShellCommand } from '../utils/shell';
import { resolveAgentPath, PROJECT_ROOT } from '../paths';
import { scrubSecrets } from './_helpers';

export const runCommand = tool({
    description: 'Execute a shell command and return its output. Commands run with a 30-second timeout. Secret values in output are automatically redacted.',
    inputSchema: z.object({
        command: z.string().describe('Shell command to execute'),
        cwd: z.string().describe('Working directory (relative to project root or absolute, defaults to project root)').optional(),
    }),
    execute: async ({ command, cwd }) => {
        const safeCmd = unescapeShellCommand(command);
        return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
            exec(safeCmd, {
                cwd: cwd ? resolveAgentPath(cwd) : PROJECT_ROOT,
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
                shell: getShell(),
            }, (error: ExecException | null, stdout: string, stderr: string) => {
                resolve({
                    stdout: scrubSecrets(stdout?.trim().slice(0, 4000) || ''),
                    stderr: scrubSecrets(stderr?.trim().slice(0, 2000) || ''),
                    exitCode: error?.code ?? 0,
                });
            });
        });
    },
});
