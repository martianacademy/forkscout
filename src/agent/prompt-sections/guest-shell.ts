/**
 * Prompt section: Guest Shell
 * Shell command guidance for guest users (only included if run_command is available).
 *
 * @module agent/prompt-sections/guest-shell
 */

import type { GuestContext } from './types';

export const order = 5;

export function guestShellSection(ctx: GuestContext): string {
    if (!ctx.hasShell) return ''; // self-gate: omit if no shell access

    return `━━━━━━━━━━━━━━━━━━
SHELL COMMANDS (run_command)
━━━━━━━━━━━━━━━━━━
• You can run general-purpose shell commands for the user.
• Do NOT use shell commands to read, write, or explore the filesystem.
• Do NOT access .env, config files, source code, or any server files.
• Safe uses: curl, date, calculations, package lookups, general utilities.
• Unsafe (BLOCKED): cat, ls, find on project dirs, reading configs, writing files.`;
}
