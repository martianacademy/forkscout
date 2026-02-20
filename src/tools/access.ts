/**
 * Tool Access Control — tag-based access levels for tools.
 *
 * Each tool self-declares its access level at the definition site:
 *   export const think = withAccess('guest', tool({ ... }));
 *
 * Untagged tools default to 'admin' (safe default — new tools are
 * locked down unless explicitly opened to guests).
 *
 * The agent's getToolsForContext() reads the tag dynamically,
 * so there's no hardcoded allowlist to maintain.
 *
 * @module tools/access
 */

/** Access levels for tools */
export type ToolAccess = 'guest' | 'admin';

/** Symbol key to avoid collisions with tool properties */
const ACCESS_KEY = Symbol.for('forkscout.tool.access');

/** Attach an access level to a Vercel AI SDK tool definition */
export function withAccess<T>(access: ToolAccess, toolDef: T): T {
    (toolDef as any)[ACCESS_KEY] = access;
    return toolDef;
}

/** Get the access level of a tool (defaults to 'admin' for untagged tools) */
export function getToolAccess(toolDef: any): ToolAccess {
    return toolDef?.[ACCESS_KEY] ?? 'admin';
}
