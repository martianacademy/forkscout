/**
 * Tool Error Enhancer — wraps tool execute functions to produce
 * structured, helpful error messages that guide the LLM to debug
 * rather than blindly retry.
 *
 * When a tool throws or returns an error, this wrapper catches it
 * and returns a structured message telling the model:
 *   1. What failed
 *   2. The exact error message
 *   3. Suggested next steps (based on error type)
 *
 * @module tools/error-enhancer
 */

/** Error patterns and their suggested remediation */
const ERROR_GUIDES: Array<{ pattern: RegExp; guide: string }> = [
    {
        pattern: /ENOENT|no such file|not found/i,
        guide: 'The file or directory does not exist. Use run_command with "ls" to check what exists at the path.',
    },
    {
        pattern: /EACCES|permission denied/i,
        guide: 'Permission denied. Check file ownership and permissions with "ls -la".',
    },
    {
        pattern: /ENOSPC|no space/i,
        guide: 'Disk is full. Check disk usage with "df -h" and clean up if needed.',
    },
    {
        pattern: /syntax error|unexpected token|parse error/i,
        guide: 'The command has a syntax error. Check for unescaped special characters, mismatched quotes, or HTML entities like &amp; instead of &.',
    },
    {
        pattern: /command not found|not recognized/i,
        guide: 'The command is not installed or not in PATH. Check with "which <command>" or install it.',
    },
    {
        pattern: /timeout|timed out/i,
        guide: 'The command timed out. It may be hanging. Try a simpler version of the command or check if a process is stuck.',
    },
    {
        pattern: /connection refused|ECONNREFUSED/i,
        guide: 'Connection refused. The service may not be running. Check with "ps aux | grep <service>".',
    },
    {
        pattern: /exit code [^0]|exitCode[:\s]+[^0]/i,
        guide: 'The command exited with a non-zero status. Read stderr carefully for the specific error.',
    },
];

/**
 * Given a tool error, produce a structured message that helps the LLM debug.
 */
export function enhanceToolError(toolName: string, error: unknown): string {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined;

    // Find applicable guide
    let guide = 'Investigate the error. Read the message carefully, then use tools to understand the root cause before retrying.';
    for (const { pattern, guide: g } of ERROR_GUIDES) {
        if (pattern.test(errMsg)) {
            guide = g;
            break;
        }
    }

    return [
        `⚠️ TOOL ERROR in "${toolName}"`,
        `Error: ${errMsg}`,
        errStack ? `Stack: ${errStack}` : null,
        ``,
        `NEXT STEPS: ${guide}`,
        `Do NOT retry the same command without understanding why it failed first.`,
    ].filter(Boolean).join('\n');
}

/**
 * Wrap a tool's execute function to catch errors and return enhanced error messages.
 * The AI SDK will feed the return value back to the model, so it gets actionable guidance.
 */
export function wrapToolWithErrorEnhancer<T extends (...args: any[]) => Promise<any>>(
    toolName: string,
    executeFn: T,
): T {
    return (async (...args: any[]) => {
        try {
            return await executeFn(...args);
        } catch (error) {
            // Return the enhanced error as a tool result rather than throwing
            // This way the model sees the error and can act on it
            return enhanceToolError(toolName, error);
        }
    }) as T;
}

/**
 * Wrap all tools in a tool set with error enhancement.
 * Mutates the tool set in place for convenience.
 */
export function enhanceToolSet(tools: Record<string, any>): void {
    for (const [name, tool] of Object.entries(tools)) {
        if (tool && typeof tool.execute === 'function') {
            const original = tool.execute.bind(tool);
            tool.execute = wrapToolWithErrorEnhancer(name, original);
        }
    }
}
