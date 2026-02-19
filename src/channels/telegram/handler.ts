/**
 * Telegram message handler — processes incoming updates and generates AI responses.
 */

import { stepCountIs, type UIMessage } from 'ai';
import { generateTextWithRetry } from '../../llm/retry';
import type { ModelTier } from '../../llm/router';
import { createReasoningContext, createPrepareStep, getReasoningSummary } from '../../llm/reasoning';
import { buildFailureObservation } from '../../memory';
import type { Agent, ChatContext } from '../../agent';
import { requestTracker } from '../../request-tracker';
import type { TelegramUpdate } from './types';
import { describeToolCall, humanTimeAgo } from './types';
import { downloadFile, sendMessage, sendTyping } from './api';
import type { TelegramStateManager } from './state';

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
        // Build enriched system prompt — include missed-message context
        // Use text for prompt query; fall back to a type description for non-text messages
        const queryText = text || describeMessageType(msg);
        let queryForPrompt = queryText;
        if (isMissed) {
            const msgTime = new Date(msg.date * 1000);
            const ago = humanTimeAgo(msgTime);
            queryForPrompt = `[This message was sent ${ago} while you were offline. Acknowledge that you were away and respond helpfully.]\n\n${queryText}`;
        }

        let systemPrompt = await agent.buildSystemPrompt(queryForPrompt, ctx);

        // If resuming after a restart, inject context about already-completed steps
        if (resumeContext) {
            systemPrompt += '\n\n' + resumeContext;
        }

        agent.saveToMemory('user', queryText, ctx);

        // Refresh typing every ~4 seconds during generation
        const typingInterval = setInterval(() => sendTyping(token, chatId), 4000);

        const { model: tgModel, tier: tgTier, complexity: tgComplexity } = agent.getModelForChat(queryText);

        // Build reasoning context for multi-phase reasoning
        const reasoningCtx = createReasoningContext(
            queryText,
            tgComplexity,
            tgTier as ModelTier,
            systemPrompt,
            agent.getRouter(),
        );

        // Track early text sent during generation so we don't double-send
        let earlyTextSent = '';
        let stepCounter = 0;

        // Track request for abort capability
        const { id: tgReqId, signal: tgAbortSignal } = requestTracker.start('telegram', who);

        const { text: responseText, usage } = await generateTextWithRetry({
            model: tgModel,
            system: systemPrompt,
            messages: history.map(m => {
                const contentParts: any[] = [];
                for (const p of (m.parts || []) as any[]) {
                    if (p.type === 'text' && p.text) {
                        contentParts.push({ type: 'text', text: p.text });
                    } else if (p.type === 'image' && p.image) {
                        contentParts.push({ type: 'image', image: p.image, mediaType: p.mediaType });
                    }
                }
                const content =
                    contentParts.length === 1 && contentParts[0].type === 'text'
                        ? contentParts[0].text
                        : contentParts;
                return { role: m.role as 'user' | 'assistant', content };
            }),
            tools: agent.getToolsForContext(ctx),
            stopWhen: stepCountIs(20),
            abortSignal: tgAbortSignal,
            prepareStep: createPrepareStep(reasoningCtx),
            onStepFinish: async ({ text: stepText, toolCalls, toolResults }) => {
                const currentStep = stepCounter++;

                // Send acknowledgment/plan text immediately from early steps.
                // The model produces text alongside tool calls in step 0 thanks
                // to the ACKNOWLEDGE/PLAN system prompt instruction.
                // Allow up to step 3 — some models take a step or two to produce text.
                if (
                    stepText?.trim() &&
                    currentStep <= 3 &&
                    !earlyTextSent
                ) {
                    earlyTextSent = stepText.trim();
                    sendMessage(token, chatId, earlyTextSent).catch(() => { });
                    console.log(`[Telegram/Agent → early]: ${earlyTextSent.slice(0, 150)}`);
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
                    sendMessage(token, chatId, unique.join('\n')).catch(() => { });
                    sendTyping(token, chatId);
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

        clearInterval(typingInterval);

        // Remove step checkpoints from history — they were only for crash recovery.
        // On a clean completion, the final assistant message replaces them.
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].id.startsWith('checkpoint-')) {
                history.splice(i, 1);
            }
        }

        // Log reasoning summary
        const tgSummary = getReasoningSummary(reasoningCtx);
        if (tgSummary.escalated || tgSummary.toolFailures > 0) {
            console.log(`[Telegram/Reasoning]: tier=${tgSummary.finalTier}, failures=${tgSummary.toolFailures}, escalated=${tgSummary.escalated}`);
        }

        // Record cost (use final tier in case of escalation)
        if (usage) {
            agent.getRouter().recordUsage(reasoningCtx.tier, usage.inputTokens || 0, usage.outputTokens || 0);
        }

        // Learn from failures
        const tgFailureObs = buildFailureObservation(reasoningCtx, responseText || '');
        if (tgFailureObs) {
            try { agent.getMemoryManager().recordSelfObservation(tgFailureObs, 'failure-learning'); } catch { /* non-critical */ }
        }

        // Save response to memory
        agent.saveToMemory('assistant', responseText);

        // Mark in inbox as responded
        await state.addToInbox(msg, true);

        // Add assistant message to history
        const asstMsg: UIMessage = {
            id: `tg-resp-${msg.message_id}`,
            role: 'assistant' as const,
            parts: [{ type: 'text' as const, text: responseText }],
        };
        history.push(asstMsg);
        deps.trimHistory(chatId);

        // Send response — skip text that was already sent as early acknowledgment
        if (responseText.trim()) {
            let finalText = responseText.trim();
            // If the response starts with the early text, strip it to avoid double-sending
            if (earlyTextSent && finalText.startsWith(earlyTextSent)) {
                finalText = finalText.slice(earlyTextSent.length).trim();
            }
            // Also handle the case where final response IS the early text (simple answers)
            if (finalText && finalText !== earlyTextSent) {
                await sendMessage(token, chatId, finalText);
                console.log(`[Telegram/Agent → ${who}]: ${finalText.slice(0, 200)}${finalText.length > 200 ? '…' : ''}`);
            } else if (!earlyTextSent) {
                // Nothing was sent at all — send the full response
                await sendMessage(token, chatId, responseText);
                console.log(`[Telegram/Agent → ${who}]: ${responseText.slice(0, 200)}${responseText.length > 200 ? '…' : ''}`);
            } else {
                console.log(`[Telegram/Agent → ${who}]: (response already sent as early acknowledgment)`);
            }
        } else {
            console.log(`[Telegram/Agent → ${who}]: (empty response — tools ran but no text returned)`);
        }

        requestTracker.finish(tgReqId);
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram]: Error generating response for ${who}:`, errMsg);
        // Check if it was an intentional abort
        const isAborted = errMsg.includes('aborted') || errMsg.includes('abort');
        await sendMessage(token, chatId, isAborted ? '⏹️ Request was cancelled.' : 'Sorry, I hit an error processing that. Try again in a moment.');
    }
}
