/**
 * Telegram message handler — processes incoming updates and generates AI responses.
 */

import { convertToModelMessages, type UIMessage } from 'ai';
import type { Agent, ChatContext } from '../../agent';
import { requestTracker } from '../../request-tracker';
import type { TelegramUpdate, TelegramMessage } from './types';
import { humanTimeAgo } from './types';
import { downloadFile, sendMessage, editMessage, sendTyping, createTypingGuard } from './api';
import type { TelegramStateManager } from './state';
import { finalizeGeneration } from '../../utils/generation-hooks';
import { generatePreflightAck } from './preflight';
import { detectCorrection } from './correction-detector';

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

/**
 * Build compact text representation of a Telegram message for chat history.
 * Preserves meaningful context (reply chains, forwards, media descriptions)
 * while stripping all the JSON noise (from, chat, date, entities, message_id, etc.)
 * that wastes ~74% of history tokens.
 */
function buildCompactMessageText(msg: TelegramMessage): string {
    const lines: string[] = [];

    // Core text content
    const content = msg.text || msg.caption || describeMessageType(msg);

    // Reply context — just the replied-to text, not the full JSON
    if (msg.reply_to_message) {
        const replyText = msg.reply_to_message.text || msg.reply_to_message.caption || describeMessageType(msg.reply_to_message);
        const truncated = replyText.length > 80 ? replyText.slice(0, 77) + '...' : replyText;
        lines.push(`[replying to: "${truncated}"]`);
    }

    // Forward context
    if (msg.forward_from) {
        lines.push(`[forwarded from ${msg.forward_from.first_name}]`);
    } else if (msg.forward_from_chat) {
        lines.push(`[forwarded from ${msg.forward_from_chat.title || 'chat'}]`);
    } else if (msg.forward_sender_name) {
        lines.push(`[forwarded from ${msg.forward_sender_name}]`);
    }

    // Media annotations (only if there's also text/caption — otherwise describeMessageType handles it)
    if (msg.text || msg.caption) {
        if (msg.photo) lines.push('[with photo]');
        if (msg.document) lines.push(`[with file: ${msg.document.file_name || 'document'}]`);
        if (msg.video) lines.push('[with video]');
        if (msg.audio) lines.push(`[with audio: ${msg.audio.title || msg.audio.file_name || 'audio'}]`);
        if (msg.voice) lines.push('[with voice message]');
        if (msg.sticker) lines.push(`[with sticker: ${msg.sticker.emoji || ''}]`);
        if (msg.location) lines.push(`[with location: ${msg.location.latitude}, ${msg.location.longitude}]`);
    }

    // URLs from entities (useful context the LLM should see)
    if (msg.entities) {
        for (const ent of msg.entities) {
            if (ent.type === 'url' || (ent.type === 'text_link' && ent.url)) {
                // url entities: text itself IS the url. text_link: url is in ent.url
                if (ent.type === 'text_link' && ent.url) {
                    lines.push(`[link: ${ent.url}]`);
                }
            }
        }
    }

    lines.push(content);
    return lines.join('\n');
}
// ── Deduplication cache ──────────────────────────
// Prevents processing identical messages from the same chat within a short window.
// Key: "chatId:textHash", Value: timestamp. Entries expire after DEDUP_WINDOW_MS.
const recentMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 5_000; // 5 seconds

/** Prune expired entries (called on each message to avoid memory leak) */
function pruneDedup(): void {
    const now = Date.now();
    for (const [key, ts] of recentMessages) {
        if (now - ts > DEDUP_WINDOW_MS * 2) recentMessages.delete(key);
    }
}
// ── Main handler ─────────────────────────────────────

/**
 * Handle a single Telegram update.
 * @param update   The Telegram update
 * @param isMissed True if this message was received while the bot was offline
 * @param deps     Injected dependencies (agent, api, state, history helpers)
 */
export async function handleTelegramUpdate(
    update: TelegramUpdate,
    isMissed: boolean,
    deps: TelegramHandlerDeps,
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

    // Skip commands that start with / unless it's /start or /stop
    if (text.startsWith('/') && !text.startsWith('/start') && !text.startsWith('/stop')) {
        await sendMessage(token, chatId, "I respond to regular messages, not commands. Just type what you need!");
        return;
    }

    // Handle /start
    if (text.startsWith('/start')) {
        await sendMessage(token, chatId, `Hey ${user.first_name}! 👋 I'm Forkscout. Just send me a message and I'll help out!`);
        return;
    }

    // Handle /stop — abort without starting new generation
    if (text.startsWith('/stop')) {
        const chatIdStr = String(chatId);
        const aborted = requestTracker.abortByChat('telegram', chatIdStr);
        if (aborted > 0) {
            await sendMessage(token, chatId, `⏹️ Stopped ${aborted} active task(s). What would you like to do?`);
        } else {
            await sendMessage(token, chatId, "Nothing running right now. What can I help with?");
        }
        return;
    }

    // Handle natural "stop" messages — abort without starting new generation
    const stopPatterns = /^(stop|ruk|ruko|bas|cancel|abort|band karo|rok|rokdo|enough|halt)(\s+(right now|now|it|please|everything|all|kar|karo|bhai|yaar))*[\s!.]*$/i;
    if (stopPatterns.test(text.trim())) {
        const chatIdStr = String(chatId);
        const aborted = requestTracker.abortByChat('telegram', chatIdStr);
        if (aborted > 0) {
            await sendMessage(token, chatId, `⏹️ Stopped! What would you like to do next?`);
        } else {
            await sendMessage(token, chatId, "Nothing running right now. What can I help with?");
        }
        return;
    }

    const who = user.username ? `@${user.username}` : displayName;
    const missedTag = isMissed ? ' [MISSED]' : '';
    console.log(`\n[telegram/${who} (${userId})${missedTag}]: ${text.slice(0, 200)}`);

    // ── Deduplication: reject identical messages from same chat within 5s ──
    pruneDedup();
    const dedupKey = `${chatId}:${text}`;
    const lastSeen = recentMessages.get(dedupKey);
    if (lastSeen && Date.now() - lastSeen < DEDUP_WINDOW_MS) {
        console.log(`[Telegram]: Skipping duplicate message from ${who} in chat ${chatId} (same text within ${DEDUP_WINDOW_MS}ms)`);
        return;
    }
    recentMessages.set(dedupKey, Date.now());

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

    // ── Abort any in-flight request for THIS chat so the agent focuses on this message ──
    const chatIdStr = String(chatId);
    const activeInChat = requestTracker.countByChat('telegram', chatIdStr);
    if (activeInChat > 0) {
        console.log(`[Telegram]: New message from ${who} in chat ${chatId} — aborting ${activeInChat} active request(s)`);
        requestTracker.abortByChat('telegram', chatIdStr);
    }

    await sendTyping(token, chatId);
    const history = deps.getOrCreateHistory(chatId);

    // Rate-limited typing guard — replaces raw setInterval + sendTyping spam.
    // Auto-backs-off on 429, auto-stops after 5 min, deduplicates rapid nudges.
    const typing = createTypingGuard(token, chatId);

    // History stores PLAIN text — no JSON blobs, no context annotations.
    // Telegram context (reply, forward, media) is injected only into the
    // CURRENT message at generate() time, so past turns stay clean.
    const plainText = text || msg.caption || describeMessageType(msg);
    const historyParts: any[] = [{ type: 'text' as const, text: plainText }];
    if (imageData) {
        historyParts.push({ type: 'image' as const, image: imageData.base64, mediaType: imageData.mediaType });
    }

    const userMsg: UIMessage = {
        id: `tg-${msg.message_id}`,
        role: 'user' as const,
        parts: historyParts,
    };
    history.push(userMsg);

    // Flush immediately so this message survives a mid-task restart.
    // On restart, the orphaned user message (no assistant reply) triggers auto-resume.
    await deps.flushHistory();

    // Track request for abort capability (hoisted before try so catch can call finish)
    const { id: tgReqId, signal: tgAbortSignal } = requestTracker.start('telegram', who, chatIdStr);

    try {
        // queryForPrompt = plain text for memory search + system prompt.
        // Telegram context (reply, forward) is in the messages array, not here.
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

        let stepCounter = 0;

        // ── Pre-flight acknowledgment ────────────────────
        // Fire a fast LLM call to produce a quick 1-line ack, sent BEFORE
        // Pre-flight ack — sends instantly while the main agent warms up.
        // Returns a Promise<number | null> so we can later EDIT the ack in-place
        // with the final answer, giving the user one seamless message instead of two.
        // hasPhoto passed so photo-only messages bypass the short-text skip filter.
        const ackMessageIdPromise: Promise<number | null> = generatePreflightAck(queryText, agent.getRouter(), hasPhoto)
            .then(ack => {
                if (ack) {
                    return sendMessage(token, chatId, ack).catch(err => {
                        console.warn(`[Telegram]: Pre-flight ack send failed: ${err instanceof Error ? err.message : err}`);
                        return null;
                    });
                }
                return null;
            })
            .catch(err => {
                console.warn(`[Telegram]: Pre-flight ack failed: ${err instanceof Error ? err.message : err}`);
                return null;
            });

        // ── Automatic correction detection ───────────────
        // Detects behavioral corrections ("don't call me bhai", "speak in English")
        // and saves them as permanent rules on the person's entity.
        // Runs concurrently — does not block the main generation.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        detectCorrection(queryText, agent.getRouter())
            .then(correction => {
                if (correction) {
                    agent.getMemoryManager().saveBehavioralRule(
                        displayName, correction.rule, correction.category,
                    );
                }
            })
            .catch(err => console.warn(`[Telegram]: Correction detection failed: ${err instanceof Error ? err.message : err}`));

        // Create a per-request ToolLoopAgent via the centralized factory
        // Sub-agent progress is wired per-request via onSubAgentProgress (no singleton).
        const { agent: chatAgent, reasoningCtx, modelId: chatModelId } = await agent.createChatAgent({
            userText: queryForPrompt,
            ctx,
            abortSignal: tgAbortSignal,
            onSubAgentProgress: (agentLabel, message) => {
                sendMessage(token, chatId, `🤖 *${agentLabel}*: ${message}`).catch(err =>
                    console.warn(`[Telegram]: Sub-agent progress send failed: ${err instanceof Error ? err.message : err}`),
                );
            },
        });

        typing.nudge();

        // Build messages: past history is plain text, but the LAST user message
        // gets enriched with Telegram context (reply chains, forwards, media type).
        // This matches AI SDK's separation: system | messages (history) | prompt (current).
        const modelMessages = await convertToModelMessages(history);
        if (modelMessages.length > 0) {
            const lastMsg = modelMessages[modelMessages.length - 1];
            if (lastMsg.role === 'user') {
                // Replace the last user message content with enriched version
                const enrichedText = buildCompactMessageText(msg);
                if (isMissed) {
                    const msgTime = new Date(msg.date * 1000);
                    const ago = humanTimeAgo(msgTime);
                    lastMsg.content = [{ type: 'text' as const, text: `[This message was sent ${ago} while you were offline.]\n\n${enrichedText}` }];
                } else {
                    lastMsg.content = [{ type: 'text' as const, text: enrichedText }];
                }
                // Re-attach image data if present
                if (imageData) {
                    (lastMsg.content as any[]).push({ type: 'image' as const, image: imageData.base64, mediaType: imageData.mediaType });
                }
            }
        }

        const { text: responseText, usage, steps: agentSteps, output: agentOutput } = await chatAgent.generate({
            messages: modelMessages,
            abortSignal: tgAbortSignal,
            onStepFinish: async ({ text: stepText, toolCalls }: any) => {
                const currentStep = stepCounter++;
                const hasToolCalls = toolCalls?.length > 0;

                // Log everything for debugging
                if (stepText?.trim()) {
                    console.log(`[Telegram/Agent → step ${currentStep}]: ${stepText.trim().slice(0, 150)}`);
                }
                if (hasToolCalls) {
                    console.log(
                        `[Telegram/Agent → step ${currentStep}]: ${toolCalls.length} tool call(s): ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`,
                    );
                }

                // ── Intermediate text: only send if MORE work is coming ──
                // If this step has tool calls → the loop continues → send text as progress update.
                // If this step has NO tool calls → this is the FINAL step → skip.
                //   The post-generation path sends the final answer (avoids duplicate).
                if (hasToolCalls && stepText?.trim()) {
                    const trimmed = stepText.trim();

                    // Filter noise: skip short fragments, raw JSON, narration, and tool names.
                    // Tool names leak as plain text when the model "thinks aloud" —
                    // e.g. "searchavailabletools", "runcommand". They have no spaces,
                    // no punctuation, and are all lowercase/camelCase identifiers.
                    const looksLikeToolName = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed);
                    const isSubstantive = trimmed.length > 15
                        && !trimmed.startsWith('{')
                        && !trimmed.startsWith('[')
                        && !looksLikeToolName
                        && /\s/.test(trimmed)   // must have at least one space — real sentences do
                        && !/^(I'll |Let me |Now I |Going to |I will )/.test(trimmed);

                    if (isSubstantive) {
                        const displayText = trimmed.length > 1000
                            ? trimmed.slice(0, 990) + '…'
                            : trimmed;
                        sendMessage(token, chatId, displayText).catch(err =>
                            console.warn(`[Telegram]: Intermediate text send failed: ${err instanceof Error ? err.message : err}`),
                        );
                    }
                }

                typing.nudge();
            },
        });

        typing.stop();

        // ── Post-generation: finalize + send response ────────

        const { response: resolved } = await finalizeGeneration({
            text: responseText, steps: agentSteps, usage,
            reasoningCtx, modelId: chatModelId, channel: 'telegram', agent, ctx,
            userMessage: queryText, output: agentOutput as any,
        });

        // Await the ack message_id (already resolved by now — main agent takes much longer)
        const ackMessageId = await ackMessageIdPromise;

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

        const finalText = resolved?.trim();
        if (finalText) {
            // Final safety truncation for Telegram
            const truncated = finalText.length > 4000
                ? finalText.slice(0, 3990) + '... (truncated)'
                : finalText;
            // Edit the ack in-place so ack + answer appear as one seamless message.
            // Fall back to a new sendMessage only if ack wasn't sent or edit fails.
            const edited = ackMessageId ? await editMessage(token, chatId, ackMessageId, truncated) : false;
            if (!edited) await sendMessage(token, chatId, truncated);
            console.log(`[Telegram/Agent response]: ${truncated.slice(0, 200)}...`);
        } else {
            // Agent ran out of steps without delivering an answer
            const stepCount = agentSteps?.length ?? 0;
            console.warn(`[Telegram]: Empty response after ${stepCount} step(s) — sending fallback message`);
            const fallback = `⚠️ I ran out of steps (${stepCount}) before finishing. Try rephrasing your request or asking for a smaller task.`;
            const edited = ackMessageId ? await editMessage(token, chatId, ackMessageId, fallback) : false;
            if (!edited) await sendMessage(token, chatId, fallback);
        }

    } catch (err: any) {
        typing.stop();
        if (err.name === 'AbortError') {
            console.log(`[Telegram]: Request ${tgReqId} for ${who} was aborted.`);
            await sendMessage(token, chatId, "⏹️ Request was cancelled.");
        } else {
            console.error(`[Telegram]: Error generating response for ${who}:`, err);
            await sendMessage(token, chatId, `⚠️ Error: ${err.message || 'Unknown error occurred'}`);
        }
    } finally {
        requestTracker.finish(tgReqId);
        typing.stop();
        agent.clearSubAgentProgress();

        // Always clean stale checkpoints — even after crashes
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].id.startsWith('checkpoint-')) {
                history.splice(i, 1);
            }
        }
    }
}
