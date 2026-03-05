// src/channels/telegram/stream-reply.ts — Live streaming response to Telegram

import type { AppConfig } from "@/config.ts";
import type { ModelMessage } from "ai";
import type { Message } from "@grammyjs/types";
import { streamAgent } from "@/agent/index.ts";
import { sendMessage, editMessage, deleteMessage, setMessageReaction, sendTyping } from "@/channels/telegram/api.ts";
import { mdToHtml, splitMarkdown, stripHtml } from "@/channels/telegram/format.ts";
import { saveSemanticTurn, summarizeAssistantResponse, extractToolsUsed } from "@/channels/semantic-store.ts";
import { TOOL_LABELS, toolInputPreview } from "@/channels/telegram/tool-progress.ts";
import { log } from "@/logs/logger.ts";
import { sleep } from "@/channels/telegram/api-utils.ts";

const logger = log("telegram/stream-reply");
const DOTS = [".", "..", "..."];

/**
 * Streams a live agent response into Telegram for rawMsg.
 * Manages thinking placeholder, tool bubble, flush throttle, and final chunked reply.
 */
export async function streamReply(
    token: string,
    config: AppConfig,
    sessionKey: string,
    chatId: number,
    rawMsg: Message,
    currentContent: string,
    chatHistory: ModelMessage[],
    role: "owner" | "admin" | "user",
    abortSignal?: AbortSignal
): Promise<void> {
    let dotIdx = 0;
    let thinkingMsgId: number | null = await sendMessage(token, chatId, "⚡ Thinking.").catch(() => null);
    let thinkingActive = true;
    sendTyping(token, chatId).catch(() => { });

    const thinkingLoop = (async () => {
        let typingCounter = 0;
        while (thinkingActive) {
            await sleep(2000);  // 2s cadence — keeps well under Telegram's ~20 edits/min limit
            if (!thinkingActive) break;
            dotIdx = (dotIdx + 1) % DOTS.length;
            if (thinkingMsgId) {
                await editMessage(token, chatId, thinkingMsgId, `⚡ Thinking${DOTS[dotIdx]}`).catch(() => { });
            }
            typingCounter++;
            if (typingCounter % 2 === 0) sendTyping(token, chatId).catch(() => { });  // every ~4s
        }
    })();

    let responseMsgId: number | null = null;
    let responseText = "";
    let toolBubbleId: number | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let firstToken = true;

    const reasoningTagCfg = config.llm.reasoningTag?.trim();
    const thinkStripRe = reasoningTagCfg
        ? new RegExp(`<${reasoningTagCfg}>[\\s\\S]*?<\\/${reasoningTagCfg}>\\n?`, "gi")
        : null;

    const flushToTelegram = async (): Promise<void> => {
        const cleanText = thinkStripRe ? responseText.replace(thinkStripRe, "").trim() : responseText;
        if (!cleanText) return;
        const safe = cleanText.length > 3900 ? cleanText.slice(0, 3897) + "…" : cleanText;
        if (responseMsgId) {
            await editMessage(token, chatId, responseMsgId, safe).catch(() => { });
        } else {
            responseMsgId = await sendMessage(token, chatId, safe).catch(() => null);
        }
    };

    const scheduleFlush = (): void => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => { flushTimer = null; flushToTelegram().catch(() => { }); }, 800);
    };

    const onToolCall = async (toolName: string, input: unknown): Promise<void> => {
        const label = TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
        const preview = toolInputPreview(input);
        const text = preview
            ? `⚙️ <b>${label}</b>\n<code>${preview.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`
            : `⚙️ <b>${label}</b>`;
        toolBubbleId = await sendMessage(token, chatId, text, "HTML").catch(() => null);
    };

    const onStepFinish = async (hadToolCalls: boolean): Promise<void> => {
        if (hadToolCalls && toolBubbleId) { await deleteMessage(token, chatId, toolBubbleId).catch(() => { }); toolBubbleId = null; }
    };

    let streamResult: Awaited<ReturnType<typeof streamAgent>>;
    try {
        streamResult = await streamAgent(config, {
            userMessage: currentContent, chatHistory, role,
            meta: { channel: "telegram", chatId, sessionKey }, abortSignal, onToolCall, onStepFinish,
        });
        for await (const token_text of streamResult.textStream) {
            if (firstToken) {
                firstToken = false; thinkingActive = false;
                if (thinkingMsgId) { const _id = thinkingMsgId; thinkingMsgId = null; await deleteMessage(token, chatId, _id).catch(() => { }); }
            }
            responseText += token_text;
            scheduleFlush();
        }
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await flushToTelegram();
    } finally {
        thinkingActive = false;
        if (thinkingMsgId) { const _id = thinkingMsgId; thinkingMsgId = null; await deleteMessage(token, chatId, _id).catch(() => { }); }
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await thinkingLoop;
    }

    if (abortSignal?.aborted) {
        logger.info(`[abort] Cleaning up aborted task for chatId=${chatId}`);
        if (responseMsgId) await deleteMessage(token, chatId, responseMsgId).catch(() => { });
        if (toolBubbleId) await deleteMessage(token, chatId, toolBubbleId).catch(() => { });
        return;
    }

    const result = await streamResult!.finalize();
    if (toolBubbleId) await deleteMessage(token, chatId, toolBubbleId).catch(() => { });
    saveSemanticTurn(sessionKey, {
        ts: Date.now(),
        user: currentContent,
        assistant: result.text?.trim() ?? summarizeAssistantResponse(result.responseMessages),
        tools: extractToolsUsed(result.responseMessages),
    });

    const replyText = result.text?.trim();
    if (!replyText) {
        logger.warn(`[agent] empty reply for chatId=${chatId} message_id=${rawMsg.message_id}`);
        if (responseMsgId) await deleteMessage(token, chatId, responseMsgId).catch(() => { });
        await sendMessage(token, chatId, "⚠️ No response from agent.");
        await setMessageReaction(token, chatId, rawMsg.message_id, "✅").catch(() => { });
        return;
    }

    const chunks = splitMarkdown(replyText).map(mdToHtml);
    const [first, ...rest] = chunks;
    if (responseMsgId) {
        await editMessage(token, chatId, responseMsgId, first, "HTML").catch(() => editMessage(token, chatId, responseMsgId!, stripHtml(first)));
    } else {
        await sendMessage(token, chatId, first, "HTML").catch(() => sendMessage(token, chatId, stripHtml(first)));
    }
    for (const chunk of rest) {
        await sendMessage(token, chatId, chunk, "HTML").catch(() => sendMessage(token, chatId, stripHtml(chunk)));
    }
    await setMessageReaction(token, chatId, rawMsg.message_id, "✅").catch(() => { });
}
