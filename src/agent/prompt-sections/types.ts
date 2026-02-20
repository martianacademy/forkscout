/**
 * Shared types for prompt sections.
 *
 * @module agent/prompt-sections/types
 */

/** Context passed to guest prompt sections */
export interface GuestContext {
    toolNames: string[];
    hasTodos: boolean;
    hasShell: boolean;
}

/** Context passed to sub-agent prompt sections */
export interface SubAgentContext {
    /** Display label for this sub-agent (e.g. "researcher-1") */
    label: string;
    /** All tool names available to this sub-agent */
    toolNames: string[];
    /** Optional context string from the parent agent */
    taskContext?: string;
    /** Set of builtin tool names (to distinguish MCP tools) */
    builtinToolNames?: Set<string>;
}
