/**
 * Channel authorization tools — list, grant, revoke access for external channel users.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { ChannelAuthStore } from '../channels/auth';
import type { ToolDeps } from './deps';

/** Auto-discovered by auto-loader — called with ToolDeps at startup. */
export function register(deps: ToolDeps) {
    return createChannelAuthTools(deps.channelAuth);
}

/**
 * Create tools for managing channel user authorization.
 * These are admin-only tools — the agent uses them when the admin asks
 * to list, grant, or revoke access for users on external channels.
 */
export function createChannelAuthTools(channelAuth: ChannelAuthStore) {
    return {
        list_channel_users: tool({
            description: `List all users who have messaged you on external channels (Telegram, WhatsApp, Discord, etc.). Shows their channel, user ID, display name, message count, last seen, and current role (guest/trusted/admin). Use this when the admin asks "who's been chatting?" or "list channel users" or "show me channel requests".`,
            inputSchema: z.object({
                channel: z.string().optional().describe('Filter by channel type (telegram, whatsapp, discord, slack). Omit to show all.'),
            }),
            execute: async ({ channel }) => {
                const sessions = channelAuth.listSessions();
                const grants = channelAuth.listGrants();
                const filtered = channel
                    ? sessions.filter(s => s.channel.toLowerCase() === channel.toLowerCase())
                    : sessions;

                if (filtered.length === 0 && grants.length === 0) {
                    return 'No channel sessions or grants recorded yet. Users will appear here once they message you via an external channel (Telegram, WhatsApp, etc.).';
                }

                let result = `=== CHANNEL USERS (${filtered.length} session(s)) ===\n\n`;
                for (const s of filtered) {
                    const roleIcon = s.role === 'admin' ? '👑' : s.role === 'trusted' ? '⭐' : '👤';
                    result += `${roleIcon} ${s.displayName || 'unknown'} | ${s.channel}:${s.userId}\n`;
                    result += `   Messages: ${s.messageCount} | First: ${s.firstSeen.slice(0, 16)} | Last: ${s.lastSeen.slice(0, 16)}\n`;
                    result += `   Role: ${s.role.toUpperCase()}`;
                    if (s.metadata && Object.keys(s.metadata).length > 0) {
                        result += ` | Meta: ${Object.entries(s.metadata).map(([k, v]) => `${k}=${v}`).join(', ')}`;
                    }
                    result += '\n\n';
                }

                if (grants.length > 0) {
                    result += `--- Persistent Grants (${grants.length}) ---\n`;
                    for (const g of grants) {
                        result += `  ${g.channel}:${g.userId} → ${g.role}${g.label ? ` (${g.label})` : ''} — granted by ${g.grantedBy} at ${g.grantedAt.slice(0, 16)}\n`;
                    }
                }

                return result;
            },
        }),

        grant_channel_access: tool({
            description: `Grant admin or trusted role to a user on an external channel. Only usable by the admin. Example: grant admin to telegram user 123456789. The grant persists across restarts. 'admin' = full access (sees personal data, all tools). 'trusted' = extended chat but not full admin.`,
            inputSchema: z.object({
                channel: z.string().describe('Channel type: telegram, whatsapp, discord, slack, etc.'),
                userId: z.string().describe('The unique user ID on that channel (Telegram ID, phone number, Discord user ID, etc.)'),
                role: z.enum(['admin', 'trusted']).describe('Role to grant: admin (full access) or trusted (extended but limited)'),
                label: z.string().optional().describe('Human-readable label for this user (e.g. "Mom", "John from work")'),
            }),
            execute: async ({ channel, userId, role, label }) => {
                await channelAuth.grantRole(channel, userId, role, 'admin', label);
                return `✅ Granted ${role.toUpperCase()} to ${channel}:${userId}${label ? ` (${label})` : ''}.\n\nThis user will now be treated as ${role} on all future messages from ${channel}. Grant persists across restarts.`;
            },
        }),

        revoke_channel_access: tool({
            description: `Revoke a user's admin/trusted access on an external channel, demoting them back to guest. Only usable by the admin. Example: revoke access for telegram user 123456789.`,
            inputSchema: z.object({
                channel: z.string().describe('Channel type: telegram, whatsapp, discord, slack, etc.'),
                userId: z.string().describe('The unique user ID to revoke'),
            }),
            execute: async ({ channel, userId }) => {
                const removed = await channelAuth.revokeGrant(channel, userId);
                if (removed) {
                    return `✅ Revoked access for ${channel}:${userId}. They are now a guest.`;
                }
                return `No existing grant found for ${channel}:${userId}. They were already a guest.`;
            },
        }),
    };
}
