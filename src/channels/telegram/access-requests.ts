// src/channels/telegram/access-requests.ts
// Persists Telegram access requests in .forkscout/access-requests.json
// Owners use /allow <userId> or /deny <userId> to action them.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve(process.cwd(), ".forkscout");
const REQUESTS_FILE = resolve(DATA_DIR, "access-requests.json");
const AUTH_FILE = resolve(DATA_DIR, "auth.json");

export type RequestStatus = "pending" | "approved" | "denied";
export type ApprovedRole = "admin" | "user";

export interface AccessRequest {
    userId: number;
    chatId: number;
    username: string | null;
    firstName: string | null;
    requestedAt: string;
    status: RequestStatus;
    role?: ApprovedRole;       // set when approved
    reviewedAt?: string;
    reviewedBy?: number; // userId of the owner who actioned the request
}

/**
 * In-memory cache — loaded once on first access, updated synchronously on every write.
 * This ensures all updates within a single polling batch see a consistent state,
 * preventing the race condition where multiple queued messages each trigger "first contact".
 */
let _cache: AccessRequest[] | null = null;

function getCache(): AccessRequest[] {
    if (_cache !== null) return _cache;
    if (!existsSync(REQUESTS_FILE)) {
        _cache = [];
        return _cache;
    }
    try {
        _cache = JSON.parse(readFileSync(REQUESTS_FILE, "utf-8")) as AccessRequest[];
    } catch {
        _cache = [];
    }
    return _cache;
}

export function loadRequests(): AccessRequest[] {
    return getCache();
}

export function saveRequests(requests: AccessRequest[]): void {
    _cache = requests;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2) + "\n", "utf-8");
}

/** Add a new request, or update an existing one's metadata (re-request after denial etc.) */
export function upsertRequest(
    requests: AccessRequest[],
    data: { userId: number; chatId: number; username: string | null; firstName: string | null }
): AccessRequest[] {
    const idx = requests.findIndex((r) => r.userId === data.userId);
    const entry: AccessRequest = {
        ...data,
        requestedAt: idx >= 0 ? requests[idx].requestedAt : new Date().toISOString(),
        status: idx >= 0 ? requests[idx].status : "pending",
    };
    if (idx >= 0) {
        const updated = [...requests];
        updated[idx] = entry;
        return updated;
    }
    return [...requests, entry];
}

/** Update status of an existing request, optionally assigning a role */
export function updateRequestStatus(
    requests: AccessRequest[],
    userId: number,
    status: RequestStatus,
    reviewedBy: number,
    role?: ApprovedRole
): AccessRequest[] {
    return requests.map((r) =>
        r.userId === userId
            ? { ...r, status, reviewedAt: new Date().toISOString(), reviewedBy, ...(role ? { role } : {}) }
            : r
    );
}

/**
 * Add userId to the persistent .forkscout/auth.json allowlist.
 * role="admin" → ownerUserIds, role="user" → allowedUserIds.
 * Safe to call multiple times — deduplicates automatically.
 */
export function addToAuthAllowList(userId: number, role: ApprovedRole = "user"): void {
    let auth: Record<string, any> = {};
    if (existsSync(AUTH_FILE)) {
        try {
            auth = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
        } catch { /* corrupt file — start fresh */ }
    }
    const key = role === "admin" ? "ownerUserIds" : "allowedUserIds";
    const existing: number[] = auth?.telegram?.[key] ?? [];
    if (existing.includes(userId)) return;
    auth = {
        ...auth,
        telegram: {
            ...(auth.telegram ?? {}),
            [key]: [...existing, userId],
        },
    };
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2) + "\n", "utf-8");
}
