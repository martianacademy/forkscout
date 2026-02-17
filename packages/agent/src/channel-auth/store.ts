/**
 * Channel Authorization Store
 *
 * Manages which users on external channels (Telegram, WhatsApp, Discord, etc.)
 * have been granted admin access by the real admin.
 *
 * Flow:
 *   1. User messages agent via Telegram → tracked as a "channel session"
 *   2. Admin (localhost / ADMIN_SECRET) asks: "list channel users" → sees all sessions
 *   3. Admin says: "grant admin to telegram user 123456" → stored persistently
 *   4. Next time that user messages → detectChatContext sees them as admin
 *
 * Persistence: .forkscout/channel-auth.json
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import { AGENT_ROOT } from '../paths';
import type { ChannelType, ChannelGrant, ChannelSession, ChannelAuthData } from './types';

export class ChannelAuthStore {
    private grants: ChannelGrant[] = [];
    private sessions: Map<string, ChannelSession> = new Map();
    private filePath: string;
    private dirty = false;

    constructor(dataDir?: string) {
        const dir = dataDir || resolvePath(AGENT_ROOT, '.forkscout');
        this.filePath = resolvePath(dir, 'channel-auth.json');
    }

    /** Load grants from disk */
    async init(): Promise<void> {
        try {
            const raw = await readFile(this.filePath, 'utf-8');
            const data: ChannelAuthData = JSON.parse(raw);
            this.grants = data.grants || [];
            console.log(`[ChannelAuth]: Loaded ${this.grants.length} grant(s)`);
        } catch {
            this.grants = [];
        }
    }

    /** Persist grants to disk */
    async flush(): Promise<void> {
        if (!this.dirty) return;
        const dir = resolvePath(this.filePath, '..');
        await mkdir(dir, { recursive: true });
        const data: ChannelAuthData = { grants: this.grants, version: 1 };
        await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
        this.dirty = false;
    }

    // ── Session tracking ──────────────────────────────

    private sessionKey(channel: string, userId: string): string {
        return `${channel.toLowerCase()}:${userId}`;
    }

    /**
     * Track an incoming message from a channel user.
     * Called by the server on every request from an external channel.
     */
    trackSession(
        channel: string,
        userId: string,
        displayName?: string,
        metadata?: Record<string, string>,
    ): ChannelSession {
        const key = this.sessionKey(channel, userId);
        const now = new Date().toISOString();
        const existing = this.sessions.get(key);

        if (existing) {
            existing.messageCount++;
            existing.lastSeen = now;
            if (displayName) existing.displayName = displayName;
            if (metadata) existing.metadata = { ...existing.metadata, ...metadata };
            existing.role = this.getRole(channel, userId);
            return existing;
        }

        const session: ChannelSession = {
            channel: channel.toLowerCase() as ChannelType,
            userId,
            displayName,
            metadata,
            messageCount: 1,
            firstSeen: now,
            lastSeen: now,
            role: this.getRole(channel, userId),
        };
        this.sessions.set(key, session);
        return session;
    }

    /** Get all tracked sessions */
    listSessions(): ChannelSession[] {
        return Array.from(this.sessions.values());
    }

    // ── Grant management ──────────────────────────────

    /** Check if a channel+userId combo has a grant */
    getGrant(channel: string, userId: string): ChannelGrant | undefined {
        return this.grants.find(
            (g) => g.channel.toLowerCase() === channel.toLowerCase() && g.userId === userId,
        );
    }

    /** Get the effective role for a channel+userId */
    getRole(channel: string, userId: string): 'guest' | 'admin' | 'trusted' | 'owner' {
        const grant = this.getGrant(channel, userId);
        return grant?.role || 'guest';
    }

    /** Check if a channel+userId is admin */
    isAdmin(channel: string, userId: string): boolean {
        const role = this.getRole(channel, userId);
        return role === 'admin' || role === 'owner';
    }

    /** Grant a role to a channel user */
    async grantRole(
        channel: string,
        userId: string,
        role: 'admin' | 'trusted',
        grantedBy: string,
        label?: string,
    ): Promise<ChannelGrant> {
        this.grants = this.grants.filter(
            (g) => !(g.channel.toLowerCase() === channel.toLowerCase() && g.userId === userId),
        );

        const grant: ChannelGrant = {
            channel: channel.toLowerCase() as ChannelType,
            userId,
            role,
            grantedBy,
            grantedAt: new Date().toISOString(),
            label,
        };
        this.grants.push(grant);
        this.dirty = true;
        await this.flush();

        const key = this.sessionKey(channel, userId);
        const session = this.sessions.get(key);
        if (session) session.role = role;

        console.log(`[ChannelAuth]: Granted ${role} to ${channel}:${userId}${label ? ` (${label})` : ''}`);
        return grant;
    }

    /** Revoke a user's grant, demoting them back to guest */
    async revokeGrant(channel: string, userId: string): Promise<boolean> {
        const before = this.grants.length;
        this.grants = this.grants.filter(
            (g) => !(g.channel.toLowerCase() === channel.toLowerCase() && g.userId === userId),
        );
        const removed = this.grants.length < before;
        if (removed) {
            this.dirty = true;
            await this.flush();

            const key = this.sessionKey(channel, userId);
            const session = this.sessions.get(key);
            if (session) session.role = 'guest';

            console.log(`[ChannelAuth]: Revoked grant for ${channel}:${userId}`);
        }
        return removed;
    }

    /** List all grants */
    listGrants(): ChannelGrant[] {
        return [...this.grants];
    }
}
