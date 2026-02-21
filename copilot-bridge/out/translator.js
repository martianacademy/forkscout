"use strict";
/**
 * Translates between OpenAI Chat Completions format and VS Code LanguageModel API.
 *
 * OpenAI → vscode.lm:
 *   - system messages → prepended to first user message
 *   - user/assistant messages → LanguageModelChatMessage
 *   - tool calls in assistant → LanguageModelToolCallPart
 *   - tool results → LanguageModelToolResultPart in User message
 *   - tools array → LanguageModelChatTool[]
 *   - tool_choice → LanguageModelChatToolMode
 *
 * vscode.lm → OpenAI:
 *   - text stream parts → message.content
 *   - tool call parts → message.tool_calls[]
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
exports.translateRequest = translateRequest;
exports.collectResponse = collectResponse;
const vscode = __importStar(require("vscode"));
// ── OpenAI → vscode.lm ────────────────────────────────
function translateRequest(req) {
    const messages = [];
    let systemContent = '';
    for (const msg of req.messages) {
        switch (msg.role) {
            case 'system':
                systemContent += (systemContent ? '\n' : '') + (msg.content || '');
                break;
            case 'user': {
                const text = systemContent
                    ? systemContent + '\n\n' + (msg.content || '')
                    : (msg.content || '');
                systemContent = '';
                messages.push(vscode.LanguageModelChatMessage.User(text));
                break;
            }
            case 'assistant':
                if (msg.tool_calls?.length) {
                    const parts = [];
                    if (msg.content) {
                        parts.push(new vscode.LanguageModelTextPart(msg.content));
                    }
                    for (const tc of msg.tool_calls) {
                        let input;
                        try {
                            input = JSON.parse(tc.function.arguments || '{}');
                        }
                        catch {
                            input = {};
                        }
                        parts.push(new vscode.LanguageModelToolCallPart(tc.id, tc.function.name, input));
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(parts));
                }
                else {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(msg.content || ''));
                }
                break;
            case 'tool':
                messages.push(vscode.LanguageModelChatMessage.User([
                    new vscode.LanguageModelToolResultPart(msg.tool_call_id || '', [new vscode.LanguageModelTextPart(msg.content || '')]),
                ]));
                break;
        }
    }
    // Leftover system content with no subsequent user message
    if (systemContent) {
        messages.unshift(vscode.LanguageModelChatMessage.User(systemContent));
    }
    // Build options
    const options = {};
    if (req.tools?.length) {
        options.tools = req.tools.map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            inputSchema: t.function.parameters,
        }));
        if (req.tool_choice === 'required') {
            options.toolMode = vscode.LanguageModelChatToolMode.Required;
        }
        else if (req.tool_choice === 'none') {
            options.tools = undefined;
        }
        // 'auto' is the default — no action needed
    }
    return { messages, options };
}
// ── vscode.lm → OpenAI ────────────────────────────────
/** Collect the full stream into an OpenAI-format response */
async function collectResponse(response, modelId) {
    let textContent = '';
    const toolCalls = [];
    for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
            textContent += part.value;
        }
        else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push({
                id: part.callId,
                type: 'function',
                function: {
                    name: part.name,
                    arguments: JSON.stringify(part.input),
                },
            });
        }
    }
    const message = {
        role: 'assistant',
        content: textContent || null,
    };
    if (toolCalls.length) {
        message.tool_calls = toolCalls;
    }
    return {
        id: `chatcmpl-bridge-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
                index: 0,
                message,
                finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
            }],
    };
}
//# sourceMappingURL=translator.js.map