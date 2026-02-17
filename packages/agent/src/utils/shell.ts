/**
 * Universal shell detection — works on macOS, Linux (Debian/Ubuntu/Alpine), and Windows.
 *
 * Preference order: zsh → bash → sh
 * On Windows (where none of these exist), returns `true` so Node's exec()
 * falls back to its default (`cmd.exe` / `process.env.ComSpec`).
 */

import { existsSync } from 'fs';

const SHELL_CANDIDATES = ['/bin/zsh', '/bin/bash', '/bin/sh'] as const;

let _cachedShell: string | true | undefined;

/**
 * Returns the best available shell path, or `true` to let Node pick the OS default.
 * Result is cached after first call.
 */
export function getShell(): string | true {
    if (_cachedShell !== undefined) return _cachedShell;
    _cachedShell = SHELL_CANDIDATES.find(s => existsSync(s)) ?? true;
    return _cachedShell;
}
