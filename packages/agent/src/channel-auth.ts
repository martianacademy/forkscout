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
import { AGENT_ROOT } from './paths';

// ── Types ────────────────────────────────────────────

export type ChannelType = 'telegram' | 'whatsapp' | 'discord' | 'slack' | string;

/** A single authorized user on an external channel */
export interface ChannelGrant {
    /** Channel type: telegram, whatsapp, discord, slack, etc. */
    channel: ChannelType;
    /** Unique user identifier on that channel (telegram ID, phone number, discord ID, etc.) */
    userId: string;
    /** Human-readable label (optional) */
    label?: string;
    /** Admin level: 'owner' = full unrestricted, 'admin' = full access, 'trusted' = extended but not full */
    role: 'owner' | 'admin' | 'trusted';
    /** Who granted this (should be the admin's name) */
    grantedBy: string;
    /** ISO timestamp when granted */
    grantedAt: string;
}

/** A tracked channel session — every unique user on every channel gets one */
export interface ChannelSession {
    /** Channel type */
    channel: ChannelType;
    /** User identifier on that channel */
    userId: string;
    /** Display name / sender name */
    displayName?: string;
    /** Additional metadata from the bridge (chat ID, group name, etc.) */
    metadata?: Record<string, string>;
    /** Number of messages received */
    messageCount: number;
    /** First message timestamp */
    firstSeen: string;
    /** Last message timestamp */
    lastSeen: string;
    /** Current role */
    role: 'guest' | 'owner' | 'admin' | 'trusted';
}

interface ChannelAuthData {
    grants: ChannelGrant[];
    version: number;
}

// ── Store ────────────────────────────────────────────

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
            // File doesn't exist yet — start fresh
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

    /** Build a unique key for a channel+user combo */
    private sessionKey(channel: string, userId: string): string {
        return `${channel.toLowerCase()}:${userId}`;
    }

    /**
     * Track an incoming message from a channel user.
     * Called by the server on every request from an external channel.
     */
    trackSession(channel: string, userId: string, displayName?: string, metadata?: Record<string, string>): ChannelSession {
        const key = this.sessionKey(channel, userId);
        const now = new Date().toISOString();
        const existing = this.sessions.get(key);

        if (existing) {
            existing.messageCount++;
            existing.lastSeen = now;
            if (displayName) existing.displayName = displayName;
            if (metadata) existing.metadata = { ...existing.metadata, ...metadata };
            // Refresh role from grants
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
            g => g.channel.toLowerCase() === channel.toLowerCase() && g.userId === userId
        );
    }

    /** Get the effective role for a channel+userId */
    getRole(channel: string, userId: string): 'guest' | 'admin' | 'trusted' | "owner" {
        const grant = this.getGrant(channel, userId);
        return grant?.role || 'guest';
    }

    /** Check if a channel+userId is admin */
    isAdmin(channel: string, userId: string): boolean {
        const role = this.getRole(channel, userId);
        return role === 'admin' || role === 'owner';
    }

    /**
     * Grant a role to a channel user.
     * Only callable by the admin (enforced at the tool level).
     */
    async grantRole(
        channel: string,
        userId: string,
        role: 'admin' | 'trusted',
        grantedBy: string,
        label?: string,
    ): Promise<ChannelGrant> {
        // Remove existing grant for this user if any
        this.grants = this.grants.filter(
            g => !(g.channel.toLowerCase() === channel.toLowerCase() && g.userId === userId)
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

        // Update session if exists
        const key = this.sessionKey(channel, userId);
        const session = this.sessions.get(key);
        if (session) session.role = role;

        console.log(`[ChannelAuth]: Granted ${role} to ${channel}:${userId}${label ? ` (${label})` : ''}`);
        return grant;
    }

    /**
     * Revoke a user's grant, demoting them back to guest.
     */
    async revokeGrant(channel: string, userId: string): Promise<boolean> {
        const before = this.grants.length;
        this.grants = this.grants.filter(
            g => !(g.channel.toLowerCase() === channel.toLowerCase() && g.userId === userId)
        );
        const removed = this.grants.length < before;
        if (removed) {
            this.dirty = true;
            await this.flush();

            // Update session
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
