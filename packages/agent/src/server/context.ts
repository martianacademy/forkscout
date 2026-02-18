/**
 * Chat context detection — identify who is talking and their access level.
 *
 * Determines the ChatContext from incoming HTTP requests by examining:
 *   - Admin secret (body, header, or localhost auto-detect)
 *   - Channel (body, header, or User-Agent auto-detect)
 *   - Sender identity (body or header)
 *   - Channel auth grants
 *
 * @module server/context
 */

import type { IncomingMessage } from 'http';
import type { UIMessage } from 'ai';
import type { ChatContext, ChatChannel } from '../agent';
import type { ChannelAuthStore } from '../channels/auth';
import { getConfig } from '../config';

/**
 * Detect the chat context (who + through what medium) from the request.
 *
 * Admin detection (priority):
 *   1. Body field: { adminSecret: "xxx" } — matches ADMIN_SECRET env var
 *   2. Header: Authorization: Bearer xxx — matches ADMIN_SECRET env var
 *   3. Channel grant: channel auth store has an 'admin' grant for this channel+userId
 *   4. Auto-detect: localhost origin (frontend/terminal) = admin
 *   5. Everything else = guest
 *
 * Channel detection (priority):
 *   1. Explicit body fields: { channel, sender, metadata }
 *   2. Custom headers: X-Channel, X-Sender
 *   3. Auto-detect from User-Agent / Referer
 */
export function detectChatContext(req: IncomingMessage, body?: any, channelAuth?: ChannelAuthStore): ChatContext {
    const adminSecret = getConfig().secrets.adminSecret;

    // ── Admin detection ──────────────────────────────
    let isAdmin = false;

    // 1. Explicit admin secret in body
    if (adminSecret && body?.adminSecret === adminSecret) {
        isAdmin = true;
    }
    // 2. Authorization: Bearer <secret> header
    else if (adminSecret) {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        if (token && token === adminSecret) {
            isAdmin = true;
        }
    }
    // 3. Localhost auto-detect — browser from localhost or local curl = admin
    //    BUT: if an explicit external channel is specified (telegram, whatsapp, etc.),
    //    the request is being proxied through a bridge — don't auto-promote.
    if (!isAdmin) {
        const explicitChannel = (body?.channel || req.headers['x-channel'] || '') as string;
        const EXTERNAL_CHANNELS = new Set(['telegram', 'whatsapp', 'discord', 'slack']);
        const isExplicitExternal = EXTERNAL_CHANNELS.has(explicitChannel.toLowerCase());

        if (!isExplicitExternal) {
            const referer = (req.headers['referer'] || '').toLowerCase();
            const ua = (req.headers['user-agent'] || '').toLowerCase();
            const remoteAddr = req.socket?.remoteAddress || '';
            const isLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

            if (isLocal && (
                (referer.includes('localhost') && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari'))) ||
                ua.includes('curl') || ua.includes('httpie') || ua.includes('wget')
            )) {
                isAdmin = true;
            }
        }
    }

    // ── Build the context ────────────────────────────
    let ctx: ChatContext;

    // Explicit in body (highest priority — integrations set this)
    if (body?.channel || body?.sender) {
        ctx = {
            channel: (body.channel as ChatChannel) || 'api',
            sender: body.sender || undefined,
            isAdmin,
            metadata: body.metadata || undefined,
        };
    }
    // Custom headers
    else {
        const hChannel = req.headers['x-channel'] as string | undefined;
        const hSender = req.headers['x-sender'] as string | undefined;
        if (hChannel || hSender) {
            ctx = {
                channel: (hChannel as ChatChannel) || 'api',
                sender: hSender || undefined,
                isAdmin,
                metadata: body?.metadata || undefined,
            };
        } else {
            // Auto-detect from User-Agent / Referer
            const ua = (req.headers['user-agent'] || '').toLowerCase();
            const referer = (req.headers['referer'] || '').toLowerCase();

            if (referer.includes('localhost') && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari'))) {
                ctx = { channel: 'frontend', isAdmin };
            } else if (ua.includes('curl') || ua.includes('httpie') || ua.includes('wget')) {
                ctx = { channel: 'terminal', isAdmin };
            } else if (ua.includes('telegrambot')) {
                ctx = { channel: 'telegram', isAdmin };
            } else if (ua.includes('whatsapp')) {
                ctx = { channel: 'whatsapp', isAdmin };
            } else if (ua.includes('discord')) {
                ctx = { channel: 'discord', isAdmin };
            } else if (ua.includes('slackbot')) {
                ctx = { channel: 'slack', isAdmin };
            } else {
                ctx = { channel: 'unknown', isAdmin };
            }
        }
    }

    // 4. Channel auth grant check — if not already admin, check if this channel+userId
    //    has been granted admin/trusted by the admin via grant_channel_access tool.
    if (!ctx.isAdmin && channelAuth) {
        const userId = ctx.metadata?.userId || ctx.metadata?.telegramId
            || ctx.metadata?.chatId || ctx.metadata?.discordId
            || ctx.metadata?.phoneNumber || ctx.sender || '';
        if (userId) {
            const role = channelAuth.getRole(ctx.channel, userId);
            if (role === 'admin') {
                ctx.isAdmin = true;
            }
            // Track this session
            channelAuth.trackSession(ctx.channel, userId, ctx.sender, ctx.metadata);
        }
    }

    return ctx;
}

/**
 * Extract the user's latest text from a UIMessage array.
 */
export function extractUserText(messages: UIMessage[]): string {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return '';
    if (Array.isArray(lastUser.parts)) {
        return lastUser.parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('\n');
    }
    return '';
}
