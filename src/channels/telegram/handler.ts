/**
 * Telegram message handler — processes incoming updates and generates AI responses.
 */

import { convertToModelMessages, type UIMessage } from 'ai';
import { getConfig } from '../../config';
import { generateTextWithRetry, isVisionUnsupportedError } from '../../llm/retry';
import { buildStopConditions } from '../../llm/stop-conditions';
import type { Agent, ChatContext } from '../../agent';
import { requestTracker } from '../../request-tracker';
import type { TelegramUpdate } from './types';
import { describeToolCall, humanTimeAgo } from './types';
import { downloadFile, sendMessage, sendTyping, createTypingGuard } from './api';
import type { TelegramStateManager } from './state';
import { finalizeGeneration } from '../../utils/generation-hooks';

// ── Handler dependencies ─────────────────────────────

export interface TelegramHandlerDeps {
    agent: Agent;
    token: string;
    state: TelegramStateManager;
    getOrCreateHistory(chatId: number): UIMessage[];
    trimHistory(chatId: number): void;
    /** Flush history to disk immediately (called after pushing userMsg so it survives restarts) */
    flushHistory(): Promise<void>;
}

// ── Helpers ──────────────────────────────────────────

/** Produce a short text description for non-text messages (used for complexity detection & system prompt). */
function describeMessageType(msg: { sticker?: any; document?: any; audio?: any; voice?: any; video?: any; video_note?: any; location?: any; contact?: any; poll?: any; photo?: any }): string {
    if (msg.sticker) return `Sticker: ${msg.sticker.emoji || 'unknown'}`;
    if (msg.document) return `File: ${msg.document.file_name || 'document'}`;
    if (msg.audio) return `Audio: ${msg.audio.title || msg.audio.file_name || 'audio'}`;
    if (msg.voice) return 'Voice message';
    if (msg.video) return 'Video';
    if (msg.video_note) return 'Video note';
    if (msg.location) return `Location: ${msg.location.latitude}, ${msg.location.longitude}`;
    if (msg.contact) return `Contact: ${msg.contact.first_name}`;
    if (msg.poll) return `Poll: ${msg.poll.question}`;
    if (msg.photo) return 'Photo';
    return 'Message';
}

// ── Main handler ─────────────────────────────────────

/**
 * Handle a single Telegram update.
 * @param update   The Telegram update
 * @param isMissed True if this message was received while the bot was offline
 * @param deps     Injected dependencies (agent, api, state, history helpers)
 * @param resumeContext  If set, this is a resumed conversation — inject as context so the model knows what it already did
 */
export async function handleTelegramUpdate(
    update: TelegramUpdate,
    isMissed: boolean,
    deps: TelegramHandlerDeps,
    resumeContext?: string,
): Promise<void> {
    const { agent, token, state } = deps;
    const msg = update.message;
    if (!msg || msg.from?.is_bot) return; // skip bot messages

    // Accept all message types — the raw message JSON is forwarded to the LLM
    // so it can understand replies, forwards, stickers, documents, locations, etc.
    const hasPhoto = !!(msg.photo && msg.photo.length > 0);

    const chatId = msg.chat.id;
    const user = msg.from!;
    const userId = String(user.id);
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const text = (msg.text || msg.caption || '').trim();

    // Download photo if present (pick largest resolution)
    let imageData: { base64: string; mediaType: string } | null = null;
    if (hasPhoto) {
        const largest = msg.photo![msg.photo!.length - 1]; // Telegram sends sizes smallest→largest
        imageData = await downloadFile(token, largest.file_id);
        if (imageData) {
            console.log(`[Telegram]: Downloaded photo (${largest.width}x${largest.height})`);
        }
    }

    // Skip commands that start with / unless it's /start
    if (text.startsWith('/') && !text.startsWith('/start')) {
        await sendMessage(token, chatId, "I respond to regular messages, not commands. Just type what you need!");
        return;
    }

    // Handle /start
    if (text.startsWith('/start')) {
        await sendMessage(token, chatId, `Hey ${user.first_name}! 👋 I'm Forkscout. Just send me a message and I'll help out!`);
        return;
    }

    const who = user.username ? `@${user.username}` : displayName;
    const missedTag = isMissed ? ' [MISSED]' : '';
    console.log(`\n[telegram/${who} (${userId})${missedTag}]: ${text.slice(0, 200)}`);

    // Build chat context
    const channelAuth = agent.getChannelAuth();
    const metadata: Record<string, string> = {
        telegramId: userId,
        chatId: String(chatId),
        userId,
        displayName,
    };
    if (user.username) metadata.username = user.username;
    if (msg.chat.type !== 'private') {
        metadata.chatType = msg.chat.type;
        if (msg.chat.title) metadata.groupName = msg.chat.title;
    }

    // Check admin grant
    const role = channelAuth.getRole('telegram', userId);
    const isAdmin = role === 'admin' || role === 'owner';

    // Track session
    channelAuth.trackSession('telegram', userId, displayName, metadata);

    // Non-admin users: store in inbox, no response
    if (!isAdmin) {
        await state.addToInbox(msg, false);
        console.log(`[Telegram]: Stored message from ${who} (guest) in inbox — no reply`);
        return;
    }

    // ── Admin message — generate response ─────────

    const ctx: ChatContext = {
        channel: 'telegram',
        sender: displayName,
        isAdmin,
        metadata,
    };

    await sendTyping(token, chatId);
    const history = deps.getOrCreateHistory(chatId);

    // Rate-limited typing guard — replaces raw setInterval + sendTyping spam.
    // Auto-backs-off on 429, auto-stops after 5 min, deduplicates rapid nudges.
    const typing = createTypingGuard(token, chatId);

    // Pass the raw Telegram message as JSON — LLMs can extract all context
    // (reply chains, forwards, file metadata, stickers, locations, polls, etc.)
    const parts: any[] = [];
    const rawMsgJson = JSON.stringify(msg, null, 2);
    parts.push({ type: 'text' as const, text: `[Telegram Message]\n${rawMsgJson}` });
    // Include image binary for vision models (they need actual pixel data, not file_id)
    if (imageData) {
        parts.push({ type: 'image' as const, image: imageData.base64, mediaType: imageData.mediaType });
    }

    const userMsg: UIMessage = {
        id: `tg-${msg.message_id}`,
        role: 'user' as const,
        parts,
    };
    history.push(userMsg);

    // Flush immediately so this message survives a mid-task restart.
    // On restart, the orphaned user message (no assistant reply) triggers auto-resume.
    await deps.flushHistory();

    try {
        // Build user query — include missed-message context for the system prompt
        const queryText = text || describeMessageType(msg);
        let queryForPrompt = queryText;
        if (isMissed) {
            const msgTime = new Date(msg.date * 1000);
            const ago = humanTimeAgo(msgTime);
            queryForPrompt = `[This message was sent ${ago} while you were offline. Acknowledge that you were away and respond helpfully.]\n\n${queryText}`;
        }

        agent.saveToMemory('user', queryText, ctx);

        // Start the typing indicator (rate-limited, auto-backing-off)
        typing.start();

        // Track ALL text fragments sent during generation so we don't double-send
        const sentFragments: string[] = [];
        let stepCounter = 0;

        // Track request for abort capability
        const { id: tgReqId, signal: tgAbortSignal } = requestTracker.start('telegram', who);

        // Create a per-request ToolLoopAgent via the centralized factory
        // Sub-agent progress is wired per-request via onSubAgentProgress (no singleton).
        const { agent: chatAgent, reasoningCtx, modelId: chatModelId, plan } = await agent.createChatAgent({
            userText: queryForPrompt,
            ctx,
            systemPromptSuffix: resumeContext,
            onSubAgentProgress: (agentLabel, message) => {
                sendMessage(token, chatId, `🤖 *${agentLabel}*: ${message}`).catch(err =>
                    console.warn(`[Telegram]: Sub-agent progress send failed: ${err instanceof Error ? err.message : err}`),
                );
            },
        });

        // Send ack immediately so the user sees a fast response
        if (plan.acknowledgment) {
            sendMessage(token, chatId, plan.acknowledgment).catch(err =>
                console.warn(`[Telegram]: Ack send failed: ${err instanceof Error ? err.message : err}`),
            );
            sentFragments.push(plan.acknowledgment);
        }

        // Quick tasks with no tools needed — we're done
        if (plan.effort === 'quick' && !plan.needsTools && plan.acknowledgment) {
            typing.stop();
            agent.clearSubAgentProgress();
            requestTracker.finish(tgReqId);
            agent.saveToMemory('assistant', plan.acknowledgment, ctx);
            return;
        }

        typing.nudge();

        const { text: responseText, usage, steps: agentSteps } = await chatAgent.generate({
            messages: await convertToModelMessages(history),
            abortSignal: tgAbortSignal,
            onStepFinish: async ({ text: stepText, toolCalls, toolResults }: any) => {
                const currentStep = stepCounter++;

                // Stream ALL intermediate text (planning, reasoning, progress updates)
                // to the user as soon as the model produces it — don't wait for the end.
                if (stepText?.trim()) {
                    const fragment = stepText.trim();
                    sendMessage(token, chatId, fragment).catch(err =>
                        console.warn(`[Telegram]: Step text send failed: ${err instanceof Error ? err.message : err}`),
                    );
                    sentFragments.push(fragment);
                    console.log(`[Telegram/Agent → step ${currentStep}]: ${fragment.slice(0, 150)}`);
                }

                // Send contextual tool call descriptions
                if (toolCalls?.length) {
                    console.log(
                        `[Telegram/Agent]: ${toolCalls.length} tool call(s): ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`,
                    );
                    const descriptions = toolCalls.map(
                        // AI SDK v6 uses `input` not `args` for tool call parameters
                        (tc: any) => describeToolCall(tc.toolName, tc.input),
                    );
                    const unique = [...new Set(descriptions)];
                    sendMessage(token, chatId, unique.join('\n')).catch(err =>
                        console.warn(`[Telegram]: Tool description send failed: ${err instanceof Error ? err.message : err}`),
                    );
                    typing.nudge();
                }

                // Save step checkpoint for mid-task crash recovery.
                // If the process restarts (e.g. agent edited its own code → rebuild),
                // these checkpoints let the model know what it already accomplished.
                const hasTools = toolCalls && toolCalls.length > 0;
                const hasText = stepText?.trim();

                if (hasTools || hasText) {
                    const cpParts: string[] = [];

                    // Include the model's reasoning/plan text — this is crucial
                    // so the agent remembers WHY it was doing these steps.
                    if (hasText) {
                        cpParts.push(`  Reasoning: ${stepText!.trim().slice(0, 600)}`);
                    }

                    if (hasTools) {
                        const stepSummaries = toolCalls!.map((tc: any, i: number) => {
                            const tr = (toolResults as any)?.[i];
                            const argsStr = JSON.stringify(tc.input || {}).slice(0, 500);
                            const outputStr = tr?.output != null
                                ? String(typeof tr.output === 'object' ? JSON.stringify(tr.output) : tr.output).slice(0, 800)
                                : '(no result)';
                            return `  Tool: ${tc.toolName}\n  Args: ${argsStr}\n  Result: ${outputStr}`;
                        }).join('\n---\n');
                        cpParts.push(stepSummaries);
                    }

                    const checkpoint: UIMessage = {
                        id: `checkpoint-${msg.message_id}-step${currentStep}`,
                        role: 'assistant' as const,
                        parts: [{ type: 'text' as const, text: `[STEP_CHECKPOINT step=${currentStep}]\n${cpParts.join('\n')}` }],
                    };
                    history.push(checkpoint);
                    await deps.flushHistory();
                }
            },
        });

        typing.stop();

        // ── Post-generation: finalize + send response ────────

        // Remove step checkpoints from history — they were only for crash recovery.
        // On a clean completion, the final assistant message replaces them.
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].id.startsWith('checkpoint-')) {
                history.splice(i, 1);
            }
        }

        // Centralised finalize: resolve response, record cost, activity log, failure learning, memory save
        const { response: resolved } = await finalizeGeneration({
            text: responseText, steps: agentSteps, usage,
            reasoningCtx, modelId: chatModelId, channel: 'telegram', agent, ctx,
            userMessage: queryText,
        });

        // Mark in inbox as responded
        await state.addToInbox(msg, true);

        // Add assistant message to history
        const asstMsg: UIMessage = {
            id: `tg-resp-${msg.message_id}`,
            role: 'assistant' as const,
            parts: [{ type: 'text' as const, text: resolved }],
        };
        history.push(asstMsg);
        deps.trimHistory(chatId);

        if (resolved) {
            let finalText = resolved;

            // Strip fragments that were already sent during onStepFinish
            for (const frag of sentFragments) {
                // Only strip exact full-fragment matches (avoid partial stripping)
                if (finalText === frag) {
                    finalText = '';
                    break;
                }
                const idx = finalText.indexOf(frag);
                if (idx !== -1) {
                    finalText = (finalText.slice(0, idx) + finalText.slice(idx + frag.length)).trim();
                }
            }

            if (finalText) {
                // Safety guard: truncate absurdly long responses (e.g. raw file dumps)
                const MAX_RESPONSE_CHARS = 4000;
                if (finalText.length > MAX_RESPONSE_CHARS) {
                    console.warn(`[Telegram]: Response too long (${finalText.length} chars) — truncating to ${MAX_RESPONSE_CHARS}`);
                    finalText = finalText.slice(0, MAX_RESPONSE_CHARS) + '\n\n[… response truncated — full output was too large]';
                }
                await sendMessage(token, chatId, finalText);
                console.log(`[Telegram/Agent → ${who}]: ${finalText.slice(0, 200)}${finalText.length > 200 ? '…' : ''}`);
            } else if (sentFragments.length > 0) {
                console.log(`[Telegram/Agent → ${who}]: (response already streamed in ${sentFragments.length} step(s))`);
            }
        } else {
            console.log(`[Telegram/Agent → ${who}]: (empty response — tools ran but no text returned)`);
        }

        requestTracker.finish(tgReqId);
        agent.clearSubAgentProgress();
    } catch (err) {
        typing.stop();
        agent.clearSubAgentProgress();
        const errMsg = err instanceof Error ? err.message : String(err);

        // ── Vision unsupported: strip images and retry ──────────────────
        if (isVisionUnsupportedError(err)) {
            console.warn(`[Telegram]: Model does not support image input — stripping images and retrying`);

            // Strip image parts from ALL history messages
            let imagesStripped = 0;
            for (const m of history) {
                if (!Array.isArray(m.parts)) continue;
                const before = m.parts.length;
                m.parts = m.parts.filter((p: any) => p.type !== 'image');
                imagesStripped += before - m.parts.length;
            }

            // Check if the current user message has any text left after stripping
            const lastUserMsg = history[history.length - 1];
            const hasTextContent = lastUserMsg?.parts?.some(
                (p: any) => p.type === 'text' && p.text && !p.text.startsWith('[Telegram Message]'),
            ) ?? false;
            const hasRawJson = lastUserMsg?.parts?.some(
                (p: any) => p.type === 'text' && p.text?.includes('"text"'),
            ) ?? false;

            // If the message was image-only (no caption/text), inform user
            if (!hasTextContent && !hasRawJson && !text) {
                await sendMessage(
                    token,
                    chatId,
                    '📷 The current model doesn\'t support image input. Please describe what you need in text, or I can switch to a vision-capable model.',
                );
                await deps.flushHistory();
                return;
            }

            // Add a note so the model knows an image was present but couldn't be processed
            if (imagesStripped > 0) {
                // Prepend note to the latest user message text
                const textPart = lastUserMsg?.parts?.find((p: any) => p.type === 'text');
                if (textPart && 'text' in textPart) {
                    (textPart as any).text = `[Note: An image was included but the current model does not support vision input. Respond based on the text and context only.]\n\n${(textPart as any).text}`;
                }
            }

            try {
                // Inform the user that the image couldn't be processed
                await sendMessage(
                    token,
                    chatId,
                    '📷 The current model doesn\'t support image input — I\'ll respond based on the text only.',
                );

                await sendTyping(token, chatId);
                const { model: retryModel } = agent.getModelForTier('balanced');
                const retrySystemPrompt = await agent.buildSystemPrompt(text || 'User sent an image', ctx);

                const typingRetry = createTypingGuard(token, chatId);
                typingRetry.start();
                // Strip image parts since the retry model doesn't support vision
                const textOnlyHistory: UIMessage[] = history.map(m => ({
                    ...m,
                    parts: ((m.parts || []) as any[]).filter((p: any) => p.type !== 'image'),
                }));
                const { text: retryText } = await generateTextWithRetry({
                    model: retryModel,
                    system: retrySystemPrompt,
                    messages: await convertToModelMessages(textOnlyHistory),
                    tools: agent.getToolsForContext(ctx),
                    stopWhen: buildStopConditions(getConfig().agent),
                });
                typingRetry.stop();

                if (retryText?.trim()) {
                    await sendMessage(token, chatId, retryText);
                    console.log(`[Telegram/Agent → ${who} (vision-fallback)]: ${retryText.slice(0, 200)}`);
                }

                agent.saveToMemory('assistant', retryText || '', ctx);
                const asstMsg2: UIMessage = {
                    id: `tg-resp-${msg.message_id}`,
                    role: 'assistant' as const,
                    parts: [{ type: 'text' as const, text: retryText || '' }],
                };
                history.push(asstMsg2);
                deps.trimHistory(chatId);
                await deps.flushHistory();
            } catch (retryErr) {
                const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                console.error(`[Telegram]: Vision fallback also failed:`, retryErrMsg);
                await sendMessage(token, chatId, 'Sorry, I hit an error processing that. Try again in a moment.');
            }
            return;
        }

        console.error(`[Telegram]: Error generating response for ${who}:`, errMsg);
        // Check if it was an intentional abort
        const isAborted = errMsg.includes('aborted') || errMsg.includes('abort');
        await sendMessage(token, chatId, isAborted ? '⏹️ Request was cancelled.' : 'Sorry, I hit an error processing that. Try again in a moment.');
    }
}
