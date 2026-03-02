// src/channels/whatsapp/auth.ts — WhatsApp JID-based auth helpers
//
// Determines if a sender is an owner, allowed user, or denied.
// Owner/allowed JIDs come from forkscout.config.json and env vars.
// Dev mode = no JIDs configured → everyone is treated as owner.

import type { AppConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";

const logger = log("whatsapp");

let ownerJids: Set<string>;
let allowedJids: Set<string>;
let devMode: boolean;

export function initAuth(config: AppConfig): void {
    const wa = config.whatsapp;
    const vaultOwnerJids = (process.env.WHATSAPP_OWNER_JIDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const cfgOwnerJids = wa?.ownerJids ?? [];
    ownerJids = new Set([...vaultOwnerJids, ...cfgOwnerJids]);
    allowedJids = new Set(wa?.allowedJids ?? []);
    devMode = ownerJids.size === 0 && allowedJids.size === 0;

    if (devMode) {
        logger.warn("No owner/allowed JIDs configured — DEV MODE (everyone is owner)");
    } else {
        logger.info(`Auth: ${ownerJids.size} owner(s), ${allowedJids.size} allowed user(s)`);
    }
}

export function getRole(senderJid: string): "owner" | "user" | "denied" {
    if (devMode) return "owner";
    if (ownerJids.has(senderJid)) return "owner";
    if (allowedJids.has(senderJid)) return "user";
    // If no allowlist, everyone except owners is a user
    if (allowedJids.size === 0) return "user";
    return "denied";
}
