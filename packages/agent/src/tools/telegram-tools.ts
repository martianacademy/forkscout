/**
 * Telegram messaging tools — send messages, photos, and files via Telegram.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { TelegramBridge } from '../telegram';
import type { ChannelAuthStore } from '../channel-auth';

/**
 * Create tools that let the agent proactively send messages via Telegram.
 * Only available when a TelegramBridge is connected.
 */
export function createTelegramTools(bridge: TelegramBridge, channelAuth: ChannelAuthStore) {
    return {
        send_telegram_message: tool({
            description: `Send a proactive message to a Telegram user. Use this when the admin says "message X on telegram" or "tell Y that...".

Finding the recipient — try in this order:
1. If you have a chatId or userId already, use it directly.
2. Provide a "lookup" string (name, username, or userId) — the tool will search grants and sessions automatically.
3. For Telegram private chats, chatId equals userId, so a grant's userId works as chatId.

Note: Telegram bots can only message users who have previously /start'd the bot.`,
            inputSchema: z.object({
                text: z.string().describe('The message text to send. Supports Markdown formatting.'),
                chatId: z.string().optional().describe('Direct Telegram chat ID if known.'),
                lookup: z.string().optional().describe('Name, @username, or userId to search for in grants and sessions. The tool will resolve this to a chatId automatically.'),
            }),
            execute: async ({ text, chatId, lookup }) => {
                let resolvedChatId = chatId;
                let resolvedName = '';

                // If no direct chatId, try to resolve from lookup
                if (!resolvedChatId && lookup) {
                    const normalizedLookup = lookup.replace(/^@/, '').toLowerCase();

                    // 1. Search persistent grants (survives restarts)
                    const grants = channelAuth.listGrants().filter(g => g.channel === 'telegram');
                    for (const g of grants) {
                        if (
                            g.userId === normalizedLookup ||
                            g.userId === lookup ||
                            g.label?.toLowerCase().includes(normalizedLookup)
                        ) {
                            resolvedChatId = g.userId;
                            resolvedName = g.label || g.userId;
                            break;
                        }
                    }

                    // 2. Search in-memory sessions
                    if (!resolvedChatId) {
                        const sessions = channelAuth.listSessions().filter(s => s.channel === 'telegram');
                        for (const s of sessions) {
                            const username = s.metadata?.username?.toLowerCase() || '';
                            const displayLower = s.displayName?.toLowerCase() || '';
                            if (
                                s.userId === normalizedLookup ||
                                s.userId === lookup ||
                                username === normalizedLookup ||
                                displayLower.includes(normalizedLookup)
                            ) {
                                resolvedChatId = s.metadata?.chatId || s.userId;
                                resolvedName = s.displayName || s.userId;
                                break;
                            }
                        }
                    }
                }

                if (!resolvedChatId) {
                    const grants = channelAuth.listGrants().filter(g => g.channel === 'telegram');
                    const sessions = channelAuth.listSessions().filter(s => s.channel === 'telegram');
                    let known = '';
                    if (grants.length > 0) {
                        known += '\n\nKnown grants:\n' + grants.map(g => `  - ${g.label || 'unlabeled'} (userId: ${g.userId})`).join('\n');
                    }
                    if (sessions.length > 0) {
                        known += '\n\nActive sessions:\n' + sessions.map(s => `  - ${s.displayName || 'unknown'} (@${s.metadata?.username || '?'}, userId: ${s.userId}, chatId: ${s.metadata?.chatId || s.userId})`).join('\n');
                    }
                    return `❌ Could not find a Telegram user matching "${lookup || '(no lookup provided)'}". Provide a chatId, userId, name, or @username.${known || '\n\nNo telegram users on record yet.'}`;
                }

                try {
                    await bridge.sendMessage(Number(resolvedChatId), text);
                    const who = resolvedName || `chat ${resolvedChatId}`;
                    console.log(`[Telegram/Outbound → ${who}]: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`);
                    return `✅ Message sent to ${who} on Telegram.`;
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    return `❌ Failed to send Telegram message: ${errMsg}`;
                }
            },
        }),

        send_telegram_photo: tool({
            description: `Send a photo/image file to a Telegram user. Use this to send screenshots, generated images, or any image file.
The file must exist on disk (provide an absolute path or path relative to the agent working directory).
Recipient resolution works the same as send_telegram_message — provide chatId or lookup.`,
            inputSchema: z.object({
                filePath: z.string().describe('Path to the image file to send (e.g. "screenshots/bitcoin.png" or "/app/packages/agent/screenshots/bitcoin.png")'),
                caption: z.string().optional().describe('Optional caption text for the photo'),
                chatId: z.string().optional().describe('Direct Telegram chat ID if known'),
                lookup: z.string().optional().describe('Name, @username, or userId to search for'),
            }),
            execute: async ({ filePath, caption, chatId, lookup }) => {
                const { resolve: resolvePath } = await import('path');
                const { stat } = await import('fs/promises');
                const resolved = resolvePath(filePath);
                try {
                    await stat(resolved);
                } catch {
                    return `❌ File not found: ${resolved}`;
                }

                let resolvedChatId = chatId;
                let resolvedName = '';
                if (!resolvedChatId && lookup) {
                    const normalizedLookup = lookup.replace(/^@/, '').toLowerCase();
                    const grants = channelAuth.listGrants().filter(g => g.channel === 'telegram');
                    for (const g of grants) {
                        if (g.userId === normalizedLookup || g.userId === lookup || g.label?.toLowerCase().includes(normalizedLookup)) {
                            resolvedChatId = g.userId;
                            resolvedName = g.label || g.userId;
                            break;
                        }
                    }
                    if (!resolvedChatId) {
                        const sessions = channelAuth.listSessions().filter(s => s.channel === 'telegram');
                        for (const s of sessions) {
                            const username = s.metadata?.username?.toLowerCase() || '';
                            const displayLower = s.displayName?.toLowerCase() || '';
                            if (s.userId === normalizedLookup || s.userId === lookup || username === normalizedLookup || displayLower.includes(normalizedLookup)) {
                                resolvedChatId = s.metadata?.chatId || s.userId;
                                resolvedName = s.displayName || s.userId;
                                break;
                            }
                        }
                    }
                }
                if (!resolvedChatId) {
                    return `❌ Could not find a Telegram user matching "${lookup || '(no lookup provided)'}".
Provide a chatId, userId, name, or @username.`;
                }

                try {
                    await bridge.sendPhoto(Number(resolvedChatId), resolved, caption);
                    const who = resolvedName || `chat ${resolvedChatId}`;
                    console.log(`[Telegram/Photo → ${who}]: ${resolved}`);
                    return `✅ Photo sent to ${who} on Telegram.`;
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    return `❌ Failed to send photo: ${errMsg}`;
                }
            },
        }),

        send_telegram_file: tool({
            description: `Send any file/document to a Telegram user. Use this for non-image files (PDFs, text files, etc.).
For images, prefer send_telegram_photo instead.`,
            inputSchema: z.object({
                filePath: z.string().describe('Path to the file to send'),
                caption: z.string().optional().describe('Optional caption text'),
                chatId: z.string().optional().describe('Direct Telegram chat ID if known'),
                lookup: z.string().optional().describe('Name, @username, or userId to search for'),
            }),
            execute: async ({ filePath, caption, chatId, lookup }) => {
                const { resolve: resolvePath } = await import('path');
                const { stat } = await import('fs/promises');
                const resolved = resolvePath(filePath);
                try {
                    await stat(resolved);
                } catch {
                    return `❌ File not found: ${resolved}`;
                }

                let resolvedChatId = chatId;
                let resolvedName = '';
                if (!resolvedChatId && lookup) {
                    const normalizedLookup = lookup.replace(/^@/, '').toLowerCase();
                    const grants = channelAuth.listGrants().filter(g => g.channel === 'telegram');
                    for (const g of grants) {
                        if (g.userId === normalizedLookup || g.userId === lookup || g.label?.toLowerCase().includes(normalizedLookup)) {
                            resolvedChatId = g.userId;
                            resolvedName = g.label || g.userId;
                            break;
                        }
                    }
                    if (!resolvedChatId) {
                        const sessions = channelAuth.listSessions().filter(s => s.channel === 'telegram');
                        for (const s of sessions) {
                            const username = s.metadata?.username?.toLowerCase() || '';
                            const displayLower = s.displayName?.toLowerCase() || '';
                            if (s.userId === normalizedLookup || s.userId === lookup || username === normalizedLookup || displayLower.includes(normalizedLookup)) {
                                resolvedChatId = s.metadata?.chatId || s.userId;
                                resolvedName = s.displayName || s.userId;
                                break;
                            }
                        }
                    }
                }
                if (!resolvedChatId) {
                    return `❌ Could not find a Telegram user matching "${lookup || '(no lookup provided)'}".
Provide a chatId, userId, name, or @username.`;
                }

                try {
                    await bridge.sendDocument(Number(resolvedChatId), resolved, caption);
                    const who = resolvedName || `chat ${resolvedChatId}`;
                    console.log(`[Telegram/File → ${who}]: ${resolved}`);
                    return `✅ File sent to ${who} on Telegram.`;
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    return `❌ Failed to send file: ${errMsg}`;
                }
            },
        }),
    };
}
