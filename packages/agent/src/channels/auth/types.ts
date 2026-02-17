/**
 * Channel Authorization Types
 */

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

export interface ChannelAuthData {
    grants: ChannelGrant[];
    version: number;
}
