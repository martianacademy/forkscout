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

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
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
                    const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
                    if (msg.content) {
                        parts.push(new vscode.LanguageModelTextPart(msg.content));
                    }
                    for (const tc of msg.tool_calls) {
                        let input: object;
                        try { input = JSON.parse(tc.function.arguments || '{}'); }
                        catch { input = {}; }
                        parts.push(new vscode.LanguageModelToolCallPart(tc.id, tc.function.name, input));
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(parts));
                } else {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(msg.content || ''));
                }
                break;

            case 'tool':
                messages.push(vscode.LanguageModelChatMessage.User([
                    new vscode.LanguageModelToolResultPart(
                        msg.tool_call_id || '',
                        [new vscode.LanguageModelTextPart(msg.content || '')]
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

        if (req.tool_choice === 'required') {
            options.toolMode = vscode.LanguageModelChatToolMode.Required;
        } else if (req.tool_choice === 'none') {
            options.tools = undefined;
        }
        // 'auto' is the default — no action needed
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
