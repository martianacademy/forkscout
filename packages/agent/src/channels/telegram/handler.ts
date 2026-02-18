/**
 * Telegram message handler — processes incoming updates and generates AI responses.
 */

import { stepCountIs, type UIMessage } from 'ai';
import { generateTextWithRetry } from '../../llm/retry';
import type { ModelTier } from '../../llm/router';
import { createReasoningContext, createPrepareStep, getReasoningSummary } from '../../llm/reasoning';
import { buildFailureObservation } from '../../memory/failure-memory';
import type { Agent, ChatContext } from '../../agent';
import type { TelegramUpdate } from './types';
import { TOOL_LABELS, humanTimeAgo } from './types';
import { downloadFile, sendMessage, sendTyping } from './api';
import type { TelegramStateManager } from './state';

// ── Handler dependencies ─────────────────────────────

export interface TelegramHandlerDeps {
    agent: Agent;
    token: string;
    state: TelegramStateManager;
    getOrCreateHistory(chatId: number): UIMessage[];
    trimHistory(chatId: number): void;
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

    // Accept text messages and photo messages (with optional caption)
    const hasText = !!msg.text?.trim();
    const hasPhoto = !!(msg.photo && msg.photo.length > 0);
    if (!hasText && !hasPhoto) return; // skip unsupported message types

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

    // Build parts array — text + optional image
    const parts: any[] = [];
    if (text) parts.push({ type: 'text' as const, text });
    if (imageData) {
        parts.push({ type: 'image' as const, image: imageData.base64, mediaType: imageData.mediaType });
        if (!text) parts.unshift({ type: 'text' as const, text: 'What is in this image?' });
    }

    const userMsg: UIMessage = {
        id: `tg-${msg.message_id}`,
        role: 'user' as const,
        parts,
    };
    history.push(userMsg);

    try {
        // Build enriched system prompt — include missed-message context
        let queryForPrompt = text;
        if (isMissed) {
            const msgTime = new Date(msg.date * 1000);
            const ago = humanTimeAgo(msgTime);
            queryForPrompt = `[This message was sent ${ago} while you were offline. Acknowledge that you were away and respond helpfully.]\n\n${text}`;
        }

        const systemPrompt = await agent.buildSystemPrompt(queryForPrompt, ctx);
        agent.saveToMemory('user', text, ctx);

        // Refresh typing every ~4 seconds during generation
        const typingInterval = setInterval(() => sendTyping(token, chatId), 4000);

        const { model: tgModel, tier: tgTier, complexity: tgComplexity } = agent.getModelForChat(text);

        // Build reasoning context for multi-phase reasoning
        const reasoningCtx = createReasoningContext(
            text,
            tgComplexity,
            tgTier as ModelTier,
            systemPrompt,
            agent.getRouter(),
        );

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
            prepareStep: createPrepareStep(reasoningCtx),
            onStepFinish: ({ toolCalls }) => {
                if (toolCalls?.length) {
                    console.log(
                        `[Telegram/Agent]: ${toolCalls.length} tool call(s): ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`,
                    );
                    const labels = toolCalls.map(
                        (tc: any) => TOOL_LABELS[tc.toolName] || `⚙️ ${tc.toolName}`,
                    );
                    const unique = [...new Set(labels)];
                    sendMessage(token, chatId, unique.join('\n')).catch(() => { });
                    sendTyping(token, chatId);
                }
            },
        });

        clearInterval(typingInterval);

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

        // Send response
        if (responseText.trim()) {
            await sendMessage(token, chatId, responseText);
            console.log(`[Telegram/Agent → ${who}]: ${responseText.slice(0, 200)}${responseText.length > 200 ? '…' : ''}`);
        } else {
            console.log(`[Telegram/Agent → ${who}]: (empty response — tools ran but no text returned)`);
        }
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram]: Error generating response for ${who}:`, errMsg);
        await sendMessage(token, chatId, 'Sorry, I hit an error processing that. Try again in a moment.');
    }
}
