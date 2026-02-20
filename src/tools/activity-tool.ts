/**
 * Activity log tool — lets the agent review its own recent operations.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { readRecentActivity, getActivitySummary, getLogPath, type ActivityEventType } from '../activity-log';

export const viewActivityLog = tool({
    description: 'View recent agent activity (tool calls, LLM calls, chat messages, self-edits, startups/shutdowns). Returns a human-readable summary by default, or raw JSON events.',
    inputSchema: z.object({
        count: z.number().min(1).max(200).default(20).describe('Number of recent events to return'),
        type: z.enum(['tool_call', 'llm_call', 'chat', 'self_edit', 'startup', 'shutdown']).optional().describe('Filter by event type'),
        format: z.enum(['summary', 'json']).default('summary').describe('Output format: summary (human-readable) or json (raw events)'),
    }),
    execute: async ({ count, type, format }) => {
        try {
            if (format === 'json') {
                const events = readRecentActivity(count, type as ActivityEventType | undefined);
                return { events, count: events.length, logPath: getLogPath() };
            }
            return getActivitySummary(count);
        } catch (err) {
            return `❌ viewActivityLog failed: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
});
