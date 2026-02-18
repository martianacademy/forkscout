/**
 * HTTP utilities — low-level request/response helpers.
 *
 * @module server/http-utils
 */

import type { IncomingMessage, ServerResponse } from 'http';

// ── Server options ─────────────────────────────────────

export interface ServerOptions {
    port?: number;
    host?: string;
    cors?: boolean;
}

// ── Body reading ───────────────────────────────────────

/** Read the full request body as a UTF-8 string. */
export function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
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

/** Set permissive CORS headers on a response. */
export function setCors(res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Channel, X-Sender, X-Admin-Secret');
}
