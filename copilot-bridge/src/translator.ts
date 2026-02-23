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

import * as vscode from 'vscode';

// ── OpenAI types (subset for translation) ──────────────

export interface OpenAIContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string; detail?: string };
}

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | OpenAIContentPart[] | null;
    name?: string;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
}

export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
    };
}

export interface OpenAIRequest {
    model: string;
    messages: OpenAIMessage[];
    tools?: OpenAITool[];
    tool_choice?: string | { type: string; function?: { name: string } };
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
}

export interface OpenAIResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: OpenAIToolCall[];
        };
        finish_reason: string;
    }>;
}

// ── OpenAI → vscode.lm ────────────────────────────────

export function translateRequest(req: OpenAIRequest): {
    messages: vscode.LanguageModelChatMessage[];
    options: vscode.LanguageModelChatRequestOptions;
} {
    const messages: vscode.LanguageModelChatMessage[] = [];
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
                    const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
                    const textVal = extractText(msg.content);
                    if (textVal) {
                        parts.push(new vscode.LanguageModelTextPart(textVal));
                    }
                    for (const tc of msg.tool_calls) {
                        let input: object;
                        try { input = JSON.parse(tc.function.arguments || '{}'); }
                        catch { input = {}; }
                        parts.push(new vscode.LanguageModelToolCallPart(tc.id, tc.function.name, input));
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(parts));
                } else {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(extractText(msg.content)));
                }
                break;

            case 'tool':
                messages.push(vscode.LanguageModelChatMessage.User([
                    new vscode.LanguageModelToolResultPart(
                        msg.tool_call_id || '',
                        [new vscode.LanguageModelTextPart(extractText(msg.content))]
                    ),
                ]));
                break;
        }
    }

    // Leftover system content with no subsequent user message
    if (systemContent) {
        messages.unshift(vscode.LanguageModelChatMessage.User(systemContent));
    }

    // Build options
    const options: vscode.LanguageModelChatRequestOptions = {};

    if (req.tools?.length) {
        options.tools = req.tools.map(t => ({
            name: t.function.name,
            description: t.function.description || '',
            inputSchema: t.function.parameters,
        })
        );

        // Normalize tool_choice — can be string or { type: string }
        const choice = typeof req.tool_choice === 'object' && req.tool_choice
            ? req.tool_choice.type
            : req.tool_choice;

        if (choice === 'none') {
            options.tools = undefined;
        } else if (choice === 'required' && req.tools.length === 1) {
            // vscode.lm only supports Required mode with exactly one tool
            options.toolMode = vscode.LanguageModelChatToolMode.Required;
        } else {
            // Explicitly set Auto — vscode.lm defaults to Required otherwise
            options.toolMode = vscode.LanguageModelChatToolMode.Auto;
        }
    }

    return { messages, options };
}

// ── vscode.lm → OpenAI ────────────────────────────────

/** Collect the full stream into an OpenAI-format response */
export async function collectResponse(
    response: vscode.LanguageModelChatResponse,
    modelId: string,
): Promise<OpenAIResponse> {
    let textContent = '';
    const toolCalls: OpenAIToolCall[] = [];

    for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
            textContent += part.value;
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
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

    const message: OpenAIResponse['choices'][0]['message'] = {
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
function extractText(content: string | OpenAIContentPart[] | null | undefined): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    return content
        .filter((p): p is OpenAIContentPart & { type: 'text' } => p.type === 'text')
        .map(p => p.text || '')
        .join('\n');
}

/** Build VS Code LM parts from OpenAI content, prepending system content if any */
function buildUserParts(
    content: string | OpenAIContentPart[] | null | undefined,
    systemContent: string,
): string | (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] {
    // Simple string content — fast path
    if (!content || typeof content === 'string') {
        const text = systemContent
            ? systemContent + '\n\n' + (content || '')
            : (content || '');
        return text;
    }

    // Array content — may contain images
    const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
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
            if (systemContent && part === content.find(p => p.type === 'text')) continue;
            parts.push(new vscode.LanguageModelTextPart(part.text || ''));
        } else if (part.type === 'image_url' && part.image_url?.url) {
            const imgPart = parseImageUrl(part.image_url.url);
            if (imgPart) {
                parts.push(imgPart);
            } else {
                parts.push(new vscode.LanguageModelTextPart('[image could not be parsed]'));
            }
        }
    }

    // If no images were found, just return plain text (simpler for the model)
    if (!hasImages) {
        const allText = parts
            .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
            .map(p => p.value)
            .join('\n');
        return allText;
    }

    return parts;
}

/** Parse a data:image/...;base64,... URL into a LanguageModelDataPart */
function parseImageUrl(url: string): vscode.LanguageModelDataPart | null {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const mime = match[1];
    const base64 = match[2];

    try {
        const buffer = Buffer.from(base64, 'base64');
        return vscode.LanguageModelDataPart.image(new Uint8Array(buffer), mime);
    } catch {
        return null;
    }
}
