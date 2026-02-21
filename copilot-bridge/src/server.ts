/**
 * Bridge HTTP server — translates OpenAI Chat Completions API to vscode.lm.
 *
 * Endpoints:
 *   GET  /health              → { status: 'ok' }
 *   GET  /v1/models           → list available Copilot models
 *   POST /v1/chat/completions → chat completion (streaming + non-streaming)
 */

import * as http from 'http';
import * as vscode from 'vscode';
import { translateRequest, collectResponse, type OpenAIRequest } from './translator';

export class BridgeServer {
    private server: http.Server | null = null;
    private port: number;
    private output: vscode.OutputChannel;

    constructor(port: number, output: vscode.OutputChannel) {
        this.port = port;
        this.output = output;
    }

    start() {
        this.server = http.createServer((req, res) => {
            this.handle(req, res).catch(err => {
                this.log(`Error: ${err.message}`);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                }
                res.end(JSON.stringify({ error: { message: err.message, type: 'server_error' } }));
            });
        });

        this.server.listen(this.port, '127.0.0.1', () => {
            this.log(`Listening on http://127.0.0.1:${this.port}`);
        });

        this.server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                vscode.window.showErrorMessage(`Copilot Bridge: Port ${this.port} is in use`);
            } else {
                this.log(`Server error: ${err.message}`);
            }
        });
    }

    stop() {
        this.server?.close();
        this.server = null;
        this.log('Server stopped');
    }

    private log(msg: string) {
        this.output.appendLine(`[${new Date().toISOString()}] ${msg}`);
    }

    // ── Request router ─────────────────────────────────

    private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url || '/', `http://localhost:${this.port}`);

        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', port: this.port }));
            return;
        }

        if (url.pathname === '/v1/models' && req.method === 'GET') {
            return this.listModels(res);
        }

        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
            return this.chatCompletions(req, res);
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Not found', type: 'invalid_request_error' } }));
    }

    // ── GET /v1/models ─────────────────────────────────

    private async listModels(res: http.ServerResponse) {
        const models = await vscode.lm.selectChatModels();
        const data = models.map(m => ({
            id: m.family || m.id,
            object: 'model' as const,
            created: Math.floor(Date.now() / 1000),
            owned_by: m.vendor || 'copilot',
            _info: { id: m.id, family: m.family, vendor: m.vendor, version: m.version, maxInputTokens: m.maxInputTokens },
        }));

        this.log(`Listed ${data.length} models`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
    }

    // ── POST /v1/chat/completions ──────────────────────

    private async chatCompletions(req: http.IncomingMessage, res: http.ServerResponse) {
        const body = await readBody(req);
        const request: OpenAIRequest = JSON.parse(body);

        this.log(`Chat: model=${request.model}, msgs=${request.messages.length}, tools=${request.tools?.length || 0}, stream=${!!request.stream}`);

        // Find model
        const models = await vscode.lm.selectChatModels();
        const model = findModel(models, request.model);

        if (!model) {
            const available = models.map(m => `${m.family} (${m.vendor})`).join(', ');
            this.log(`Model not found: ${request.model}. Available: ${available}`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: `Model "${request.model}" not found. Available: ${available}`, type: 'invalid_request_error' },
            }));
            return;
        }

        this.log(`Matched: ${model.id} (family=${model.family}, vendor=${model.vendor})`);

        const { messages, options } = translateRequest(request);

        // Cancel on client disconnect
        const cts = new vscode.CancellationTokenSource();
        req.on('close', () => cts.cancel());

        if (request.stream) {
            return this.streamChat(model, messages, options, request.model, cts, res);
        }

        // Non-streaming
        const response = await model.sendRequest(messages, options, cts.token);
        const result = await collectResponse(response, request.model);

        this.log(`Done: finish=${result.choices[0].finish_reason}, chars=${result.choices[0].message.content?.length || 0}, tool_calls=${result.choices[0].message.tool_calls?.length || 0}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    }

    // ── Streaming SSE ──────────────────────────────────

    private async streamChat(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        modelId: string,
        cts: vscode.CancellationTokenSource,
        res: http.ServerResponse,
    ) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        const id = `chatcmpl-bridge-${Date.now()}`;
        const response = await model.sendRequest(messages, options, cts.token);
        let toolIdx = 0;

        for await (const part of response.stream) {
            let chunk: Record<string, any> | undefined;

            if (part instanceof vscode.LanguageModelTextPart) {
                chunk = {
                    id, object: 'chat.completion.chunk', model: modelId,
                    choices: [{ index: 0, delta: { content: part.value }, finish_reason: null }],
                };
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                chunk = {
                    id, object: 'chat.completion.chunk', model: modelId,
                    choices: [{
                        index: 0,
                        delta: {
                            tool_calls: [{
                                index: toolIdx++,
                                id: part.callId,
                                type: 'function',
                                function: { name: part.name, arguments: JSON.stringify(part.input) },
                            }],
                        },
                        finish_reason: null,
                    }],
                };
            }

            if (chunk) {
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
        }

        // Final chunk
        res.write(`data: ${JSON.stringify({
            id, object: 'chat.completion.chunk', model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
}

// ── Helpers ────────────────────────────────────────────

/** Fuzzy-find a model by family, id, or substring match */
function findModel(models: vscode.LanguageModelChat[], requested: string): vscode.LanguageModelChat | undefined {
    const lower = requested.toLowerCase();
    return models.find(m => m.family?.toLowerCase() === lower)
        || models.find(m => m.id.toLowerCase() === lower)
        || models.find(m => m.id.toLowerCase().includes(lower))
        || models.find(m => m.family?.toLowerCase().includes(lower));
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}
