import { z } from 'zod';
import { exec } from 'child_process';
import { resolveAgentPath, PROJECT_ROOT } from '../paths';

/**
 * Run Shell Command Tool
 */
export const runCommandTool = {
    name: 'run_command',
    description: 'Execute a shell command and return its output. Use for running scripts, system commands, package managers, git, etc. Commands run with a 30-second timeout.',
    parameters: z.object({
        command: z.string().describe('Shell command to execute'),
        cwd: z.string().describe('Working directory (relative to project root or absolute, defaults to project root)').optional(),
    }),
    async execute(params: { command: string; cwd?: string }): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }> {
        return new Promise((resolve) => {
            exec(
                params.command,
                {
                    cwd: params.cwd ? resolveAgentPath(params.cwd) : PROJECT_ROOT,
                    timeout: 30_000,
                    maxBuffer: 1024 * 1024, // 1MB
                    shell: '/bin/zsh',
                },
                (error, stdout, stderr) => {
                    resolve({
                        stdout: stdout?.trim().slice(0, 4000) || '',
                        stderr: stderr?.trim().slice(0, 2000) || '',
                        exitCode: error?.code ?? 0,
                    });
                }
            );
        });
    },
};

export const shellTools = [runCommandTool];
