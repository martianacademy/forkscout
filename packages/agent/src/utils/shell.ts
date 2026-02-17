/**
 * Universal shell detection — works on macOS, Linux (Debian/Ubuntu/Alpine), and Windows.
 *
 * Unix preference: zsh → bash → sh
 * Windows preference: Git Bash → PowerShell 7 → Windows PowerShell → cmd.exe
 *
 * Git Bash is strongly preferred on Windows because it provides a POSIX-compatible
 * environment with common Unix tools (grep, cat, which, etc.) that agent commands rely on.
 * PowerShell is the next best option — it supports pipes, &&, and many aliases for
 * Unix commands (ls, cat, etc.) though some syntax differs.
 */

import { existsSync } from 'fs';

const IS_WINDOWS = process.platform === 'win32';

/** Unix shell candidates in preference order */
const UNIX_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh'] as const;

/**
 * Windows shell candidates in preference order:
 * 1. Git Bash — full POSIX compatibility (grep, cat, pipes, $VAR, &&)
 * 2. PowerShell 7 (pwsh) — cross-platform, modern, supports && and pipes
 * 3. Windows PowerShell 5.1 — built into every Windows 10/11, supports && (PS7+) and pipes
 * 4. Falls back to cmd.exe via `true` (limited — no grep, $VAR, etc.)
 */
const WINDOWS_SHELLS = [
    // Git Bash paths
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Git\\bin\\bash.exe',
    // PowerShell 7 (cross-platform install)
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
    // Windows PowerShell 5.1 (always present on Win10/11)
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
] as const;

let _cachedShell: string | undefined;

/**
 * Returns the best available shell path, or `undefined` to let Node pick the OS default.
 * Result is cached after first call.
 */
export function getShell(): string | undefined {
    if (_cachedShell !== undefined) return _cachedShell;

    if (IS_WINDOWS) {
        // On Windows, prefer Git Bash for POSIX compatibility
        _cachedShell = WINDOWS_SHELLS.find(s => existsSync(s));
    } else {
        // Unix: zsh (macOS) → bash (most Linux) → sh (Alpine/minimal)
        _cachedShell = UNIX_SHELLS.find(s => existsSync(s));
    }

    return _cachedShell;
}
