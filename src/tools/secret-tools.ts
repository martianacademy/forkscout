/**
 * Secret-aware tools — list secrets and make HTTP requests with template injection.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { withAccess } from './access';
import { readFile as fsReadFile } from 'fs/promises';
import { basename } from 'path';
import { getSecretNames, resolveTemplates, scrubSecrets } from './_helpers';

export const listSecrets = tool({
    description: `List the NAME of all available secrets/API keys in the environment. Returns only names (e.g. TELEGRAM_BOT_TOKEN, LLM_API_KEY) — never values. Use this to discover what secrets are available before making API calls with http_request.`,
    inputSchema: z.object({}),
    execute: async () => {
        const names = getSecretNames();
        return {
            available: names,
            usage: 'Use {{SECRET_NAME}} syntax in http_request URLs, headers, or body to inject these values securely. The actual values never enter the conversation.',
        };
    },
});

export const httpRequest = withAccess('guest', tool({
    description: `Make an HTTP request with automatic secret injection. Use {{SECRET_NAME}} placeholders in the URL, headers, or body — they will be resolved from environment variables server-side, so the actual secret NEVER enters the conversation or LLM context.

Examples:
  URL: "https://api.telegram.org/bot{{TELEGRAM_BOT_TOKEN}}/sendMessage"
  Header: { "Authorization": "Bearer {{LLM_API_KEY}}" }
  Body: { "token": "{{MY_SECRET}}" }

For file uploads, set filePath and the file will be sent as multipart/form-data.
Use list_secrets first to discover available secret names.`,
    inputSchema: z.object({
        url: z.string().describe('The URL to request. Supports {{SECRET_NAME}} placeholders.'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET').describe('HTTP method'),
        headers: z.record(z.string()).optional().describe('Request headers. Supports {{SECRET_NAME}} placeholders in values.'),
        body: z.string().optional().describe('Request body (JSON string or plain text). Supports {{SECRET_NAME}} placeholders.'),
        filePath: z.string().optional().describe('Path to a file to upload as multipart/form-data. The file field name defaults to "file".'),
        fileField: z.string().optional().describe('Form field name for the uploaded file (default: "file")'),
        formFields: z.record(z.string()).optional().describe('Additional form fields for multipart requests. Supports {{SECRET_NAME}} placeholders in values.'),
        timeout: z.number().optional().describe('Request timeout in milliseconds (default: 30000)'),
    }),
    execute: async ({ url, method, headers, body, filePath, fileField, formFields, timeout }) => {
        try {
            // Resolve all {{SECRET}} templates
            const resolvedUrl = resolveTemplates(url);
            const resolvedHeaders: Record<string, string> = {};
            if (headers) {
                for (const [k, v] of Object.entries(headers)) {
                    resolvedHeaders[k] = resolveTemplates(v);
                }
            }

            let fetchBody: any;
            const fetchHeaders = { ...resolvedHeaders };

            if (filePath) {
                // Multipart file upload
                const { resolve: resolvePath } = await import('path');
                const resolved = resolvePath(filePath);
                const fileData = await fsReadFile(resolved);
                const fileName = basename(resolved);
                const form = new FormData();
                form.append(fileField || 'file', new Blob([fileData]), fileName);
                if (formFields) {
                    for (const [k, v] of Object.entries(formFields)) {
                        form.append(k, resolveTemplates(v));
                    }
                }
                fetchBody = form;
                // Don't set Content-Type — fetch sets it with boundary
            } else if (body) {
                fetchBody = resolveTemplates(body);
                if (!fetchHeaders['Content-Type'] && !fetchHeaders['content-type']) {
                    fetchHeaders['Content-Type'] = 'application/json';
                }
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout || 30_000);

            const res = await fetch(resolvedUrl, {
                method: method || 'GET',
                headers: Object.keys(fetchHeaders).length > 0 ? fetchHeaders : undefined,
                body: fetchBody,
                signal: controller.signal,
            });
            clearTimeout(timer);

            const contentType = res.headers.get('content-type') || '';
            let responseBody: string;
            if (contentType.includes('json')) {
                const json = await res.json();
                responseBody = JSON.stringify(json, null, 2);
            } else {
                responseBody = await res.text();
            }

            // Scrub any secrets that might appear in the response
            responseBody = scrubSecrets(responseBody);

            // Log the request (with scrubbed URL)
            console.log(`[http_request]: ${method || 'GET'} ${scrubSecrets(url)} → ${res.status}`);

            return {
                status: res.status,
                statusText: res.statusText,
                body: responseBody,
                url: scrubSecrets(url),
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { status: 0, error: scrubSecrets(msg) };
        }
    },
}));
