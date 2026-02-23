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
                systemContent += (systemContent ? '\n' : '') + extractText(msg.content);
                break;
            case 'user': {
                const parts = buildUserParts(msg.content, systemContent);
                systemContent = '';
                messages.push(vscode.LanguageModelChatMessage.User(parts));
                break;
            }
            case 'assistant':
                if (msg.tool_calls?.length) {
                    const parts = [];
                    const textVal = extractText(msg.content);
                    if (textVal) {
                        parts.push(new vscode.LanguageModelTextPart(textVal));
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
                    messages.push(vscode.LanguageModelChatMessage.Assistant(extractText(msg.content)));
                }
                break;
            case 'tool':
                messages.push(vscode.LanguageModelChatMessage.User([
                    new vscode.LanguageModelToolResultPart(msg.tool_call_id || '', [new vscode.LanguageModelTextPart(extractText(msg.content))]),
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
        // Normalize tool_choice — can be string or { type: string }
        const choice = typeof req.tool_choice === 'object' && req.tool_choice
            ? req.tool_choice.type
            : req.tool_choice;
        if (choice === 'none') {
            options.tools = undefined;
        }
        else if (choice === 'required' && req.tools.length === 1) {
            // vscode.lm only supports Required mode with exactly one tool
            options.toolMode = vscode.LanguageModelChatToolMode.Required;
        }
        else {
            // Explicitly set Auto — vscode.lm defaults to Required otherwise
            options.toolMode = vscode.LanguageModelChatToolMode.Auto;
        }
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
// ── Multipart content helpers ──────────────────────────
/** Extract plain text from content (string or array of parts) */
function extractText(content) {
    if (!content)
        return '';
    if (typeof content === 'string')
        return content;
    return content
        .filter((p) => p.type === 'text')
        .map(p => p.text || '')
        .join('\n');
}
/** Build VS Code LM parts from OpenAI content, prepending system content if any */
function buildUserParts(content, systemContent) {
    // Simple string content — fast path
    if (!content || typeof content === 'string') {
        const text = systemContent
            ? systemContent + '\n\n' + (content || '')
            : (content || '');
        return text;
    }
    // Array content — may contain images
    const parts = [];
    const hasImages = content.some(p => p.type === 'image_url');
    // Prepend system content as text
    if (systemContent) {
        const firstText = content.find(p => p.type === 'text');
        const combinedText = firstText
            ? systemContent + '\n\n' + (firstText.text || '')
            : systemContent;
        parts.push(new vscode.LanguageModelTextPart(combinedText));
    }
    for (const part of content) {
        if (part.type === 'text') {
            // Skip if already merged with system content above
            if (systemContent && part === content.find(p => p.type === 'text'))
                continue;
            parts.push(new vscode.LanguageModelTextPart(part.text || ''));
        }
        else if (part.type === 'image_url' && part.image_url?.url) {
            const imgPart = parseImageUrl(part.image_url.url);
            if (imgPart) {
                parts.push(imgPart);
            }
            else {
                parts.push(new vscode.LanguageModelTextPart('[image could not be parsed]'));
            }
        }
    }
    // If no images were found, just return plain text (simpler for the model)
    if (!hasImages) {
        const allText = parts
            .filter((p) => p instanceof vscode.LanguageModelTextPart)
            .map(p => p.value)
            .join('\n');
        return allText;
    }
    return parts;
}
/** Parse a data:image/...;base64,... URL into a LanguageModelDataPart */
function parseImageUrl(url) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match)
        return null;
    const mime = match[1];
    const base64 = match[2];
    try {
        const buffer = Buffer.from(base64, 'base64');
        return vscode.LanguageModelDataPart.image(new Uint8Array(buffer), mime);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=translator.js.map