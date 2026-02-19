/**
 * HTTP utilities — low-level request/response helpers.
 *
 * @module server/http-utils
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getConfig } from '../config';

// ── Server options ─────────────────────────────────────

export interface ServerOptions {
    port?: number;
    host?: string;
    cors?: boolean;
}

// ── Body reading ───────────────────────────────────────

/** Fallback max request body size (1 MB). */
const MAX_BODY_BYTES = 1_048_576;

/** Read the full request body as a UTF-8 string. Rejects if body exceeds configured limit. */
export function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const maxBytes = getConfig().agent.server.maxBodyBytes ?? MAX_BODY_BYTES;
        let body = '';
        let bytes = 0;
        req.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
                req.destroy();
                reject(new Error('Request body too large (max 1 MB)'));
                return;
            }
            body += chunk.toString();
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

// ── JSON response ──────────────────────────────────────

/** Send a JSON response with status code. */
export function sendJSON(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// ── CORS ───────────────────────────────────────────────

/** Allowed origins — localhost only (single-user deployment). */
const ALLOWED_ORIGINS = new Set([
    'http://localhost:3000',
    'http://localhost:3210',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3210',
]);

/** Set restrictive CORS headers — localhost only. */
export function setCors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers['origin'] || '';
    if (ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    // No origin header = same-origin request (curl, Telegram bridge, etc.) — allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Channel, X-Sender, X-Admin-Secret');
    res.setHeader('Vary', 'Origin');
}
