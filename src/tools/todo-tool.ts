/**
 * Todo Tool — structured task tracking for multi-step work.
 *
 * Gives the agent a persistent (per-session) todo list to plan, track,
 * and communicate progress on complex tasks. Each call replaces the
 * full todo list and returns the current state — keeping the agent and
 * user in sync.
 *
 * Key behaviors:
 *   - Session-scoped: todos live in memory for the agent's lifetime
 *   - Full-replace semantics: every call sends the complete list
 *   - Only ONE item should be "in-progress" at a time
 *   - Returns a formatted markdown summary after each update
 *
 * This is a zero-cost tool — no LLM call, no external request.
 *
 * @module tools/todo-tool
 */

import { tool } from 'ai';
import { z } from 'zod';
import { withAccess } from './access';

const todoItemSchema = z.object({
    id: z.number().describe('Unique numeric identifier (sequential, starting from 1)'),
    title: z.string().describe('Concise action-oriented label (3-10 words)'),
    status: z.enum(['not-started', 'in-progress', 'completed']).describe(
        'not-started: not yet begun | in-progress: currently working (max 1 at a time) | completed: finished',
    ),
    notes: z.string().optional().describe('Optional brief notes, blockers, or result summary'),
});

export type TodoItem = z.infer<typeof todoItemSchema>;

/** Session-scoped todo state. Resets when the agent restarts. */
let sessionTodos: TodoItem[] = [];

/** Format todos as a readable markdown checklist */
function formatTodos(todos: TodoItem[]): string {
    if (todos.length === 0) return '📋 Todo list is empty.';

    const completed = todos.filter(t => t.status === 'completed').length;
    const total = todos.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const lines = [
        `📋 **Progress: ${completed}/${total} (${pct}%)**`,
        '',
    ];

    for (const t of todos) {
        const icon =
            t.status === 'completed' ? '✅' :
                t.status === 'in-progress' ? '🔄' :
                    '⬜';
        const line = `${icon} ${t.id}. ${t.title}`;
        lines.push(t.notes ? `${line} — *${t.notes}*` : line);
    }

    return lines.join('\n');
}

export const manageTodos = withAccess('guest', tool({
    description:
        'Manage a structured todo list to plan and track multi-step work. ' +
        'Use this FREQUENTLY during complex tasks to: (1) break work into actionable steps, ' +
        '(2) mark items in-progress before starting, (3) mark completed immediately after finishing, ' +
        '(4) give the user visibility into your progress. ' +
        'Each call replaces the ENTIRE list — always include ALL items (existing + new). ' +
        'Keep at most ONE item "in-progress" at a time.',
    inputSchema: z.object({
        todos: z.array(todoItemSchema).describe(
            'Complete array of ALL todo items. Must include every item — both existing and new.',
        ),
    }),
    execute: async ({ todos }) => {
        // Validate: at most one in-progress
        const inProgress = todos.filter(t => t.status === 'in-progress');
        if (inProgress.length > 1) {
            console.warn(`[Todo]: Warning — ${inProgress.length} items marked in-progress (should be max 1)`);
        }

        // Store
        sessionTodos = todos;

        // Log summary
        const completed = todos.filter(t => t.status === 'completed').length;
        console.log(`[Todo]: Updated — ${completed}/${todos.length} completed`);

        return formatTodos(todos);
    },
}));

/** Get current todos (for system prompt injection or status checks) */
export function getCurrentTodos(): TodoItem[] {
    return [...sessionTodos];
}

/** Reset todos (used on agent restart or new conversation) */
export function resetTodos(): void {
    sessionTodos = [];
}
