"use strict";
/**
 * Bridge HTTP server — translates OpenAI Chat Completions API to vscode.lm.
 *
 * Endpoints:
 *   GET  /health              → { status: 'ok' }
 *   GET  /v1/models           → list available Copilot models
 *   POST /v1/chat/completions → chat completion (streaming + non-streaming)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BridgeServer = void 0;
const http = __importStar(require("http"));
const vscode = __importStar(require("vscode"));
const translator_1 = require("./translator");
class BridgeServer {
    server = null;
    port;
    output;
    constructor(port, output) {
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
        this.server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                vscode.window.showErrorMessage(`Copilot Bridge: Port ${this.port} is in use`);
            }
            else {
                this.log(`Server error: ${err.message}`);
            }
        });
    }
    stop() {
        this.server?.close();
        this.server = null;
        this.log('Server stopped');
    }
    log(msg) {
        this.output.appendLine(`[${new Date().toISOString()}] ${msg}`);
    }
    // ── Request router ─────────────────────────────────
    async handle(req, res) {
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
    async listModels(res) {
        const models = await vscode.lm.selectChatModels();
        const data = models.map(m => ({
            id: m.family || m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: m.vendor || 'copilot',
            _info: { id: m.id, family: m.family, vendor: m.vendor, version: m.version, maxInputTokens: m.maxInputTokens },
        }));
        this.log(`Listed ${data.length} models`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
    }
    // ── POST /v1/chat/completions ──────────────────────
    async chatCompletions(req, res) {
        const body = await readBody(req);
        const request = JSON.parse(body);
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
        const { messages, options } = (0, translator_1.translateRequest)(request);
        this.log(`Options: toolMode=${options.toolMode}, tools=${options.tools?.length || 0}, tool_choice=${request.tool_choice}`);
        // Cancel on client disconnect
        const cts = new vscode.CancellationTokenSource();
        req.on('close', () => cts.cancel());
        try {
            if (request.stream) {
                return await this.streamChat(model, messages, options, request.model, cts, res);
            }
            // Non-streaming
            const response = await model.sendRequest(messages, options, cts.token);
            const result = await (0, translator_1.collectResponse)(response, request.model);
            this.log(`Done: finish=${result.choices[0].finish_reason}, chars=${result.choices[0].message.content?.length || 0}, tool_calls=${result.choices[0].message.tool_calls?.length || 0}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            this.log(`sendRequest error: ${err.message}`);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({ error: { message: err.message, type: 'api_error' } }));
        }
    }
    // ── Streaming SSE ──────────────────────────────────
    async streamChat(model, messages, options, modelId, cts, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const id = `chatcmpl-bridge-${Date.now()}`;
        const response = await model.sendRequest(messages, options, cts.token);
        let toolIdx = 0;
        for await (const part of response.stream) {
            let chunk;
            if (part instanceof vscode.LanguageModelTextPart) {
                chunk = {
                    id, object: 'chat.completion.chunk', model: modelId,
                    choices: [{ index: 0, delta: { content: part.value }, finish_reason: null }],
                };
            }
            else if (part instanceof vscode.LanguageModelToolCallPart) {
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
exports.BridgeServer = BridgeServer;
// ── Helpers ────────────────────────────────────────────
/** Fuzzy-find a model by family, id, or substring match */
function findModel(models, requested) {
    const lower = requested.toLowerCase();
    return models.find(m => m.family?.toLowerCase() === lower)
        || models.find(m => m.id.toLowerCase() === lower)
        || models.find(m => m.id.toLowerCase().includes(lower))
        || models.find(m => m.family?.toLowerCase().includes(lower));
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}
//# sourceMappingURL=server.js.map