/**
 * Universal shell detection — works on macOS, Linux (Debian/Ubuntu/Alpine), and Windows.
 *
 * Unix preference: zsh → bash → sh
 * Windows preference: Git Bash → WSL bash → PowerShell → cmd.exe (OS default)
 *
 * Git Bash is strongly preferred on Windows because it provides a POSIX-compatible
 * environment with common Unix tools (grep, cat, which, etc.) that agent commands rely on.
 */

import { existsSync } from 'fs';

const IS_WINDOWS = process.platform === 'win32';

/** Unix shell candidates in preference order */
const UNIX_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh'] as const;

/** Windows shell candidates — Git Bash paths where Git for Windows typically installs */
const WINDOWS_SHELLS = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Git\\bin\\bash.exe',
] as const;

let _cachedShell: string | true | undefined;

/**
 * Returns the best available shell path, or `true` to let Node pick the OS default.
 * Result is cached after first call.
 */
export function getShell(): string | true {
    if (_cachedShell !== undefined) return _cachedShell;

    if (IS_WINDOWS) {
        // On Windows, prefer Git Bash for POSIX compatibility
        _cachedShell = WINDOWS_SHELLS.find(s => existsSync(s)) ?? true;
    } else {
        // Unix: zsh (macOS) → bash (most Linux) → sh (Alpine/minimal)
        _cachedShell = UNIX_SHELLS.find(s => existsSync(s)) ?? true;
    }

    return _cachedShell;
}
