/**
 * In-memory rate limiter — per-IP sliding window.
 *
 * Single-user deployment: limits external abuse while allowing
 * the owner (localhost) a generous quota.
 *
 * @module server/rate-limit
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getConfig } from '../config';

interface RateBucket {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, RateBucket>();

/** Fallback constants — prefer getConfig().agent.server at runtime */
const LOCAL_LIMIT = 300;
const REMOTE_LIMIT = 30;
const WINDOW_MS = 60_000;

/** Cleanup stale buckets every 5 minutes. */
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
        if (now > bucket.resetAt) buckets.delete(ip);
    }
}, 5 * 60_000).unref();

function getClientIP(req: IncomingMessage): string {
    // Trust X-Forwarded-For only if from localhost (reverse proxy)
    const remote = req.socket?.remoteAddress || '127.0.0.1';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (isLocal) {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) {
            return (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]).trim();
        }
    }
    return remote;
}

function isLocalIP(ip: string): boolean {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

/**
 * Check rate limit for incoming request.
 * Returns true if allowed, false if rate-limited (sends 429 response automatically).
 */
export function checkRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
    const ip = getClientIP(req);
    const serverCfg = getConfig().agent.server;
    const limit = isLocalIP(ip) ? (serverCfg.rateLimitLocal ?? LOCAL_LIMIT) : (serverCfg.rateLimitRemote ?? REMOTE_LIMIT);
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + (serverCfg.rateLimitWindowMs ?? WINDOW_MS) };
        buckets.set(ip, bucket);
    }

    bucket.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - bucket.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > limit) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)) });
        res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }));
        return false;
    }

    return true;
}
