// src/channels/telegram/api.ts — Telegram Bot API helpers

const BASE = "https://api.telegram.org/bot";

export async function sendMessage(
    token: string,
    chatId: number,
    text: string,
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
    };

    try {
        const res = await fetch(`${BASE}${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; result?: { message_id: number } };
        return data.ok ? (data.result?.message_id ?? null) : null;
    } catch (err) {
        console.error("[telegram/api] sendMessage failed:", err);
        return null;
    }
}

export async function editMessage(
    token: string,
    chatId: number,
    messageId: number,
    text: string,
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<boolean> {
    const body: Record<string, unknown> = {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
    };

    try {
        const res = await fetch(`${BASE}${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; description?: string };

        if (!data.ok) {
            const desc = data.description ?? "";
            // "message is not modified" is not an error
            if (desc.includes("message is not modified")) return true;
            console.error("[telegram/api] editMessage failed:", desc);
            return false;
        }
        return true;
    } catch (err) {
        console.error("[telegram/api] editMessage error:", err);
        return false;
    }
}

export async function sendTyping(token: string, chatId: number): Promise<void> {
    await fetch(`${BASE}${token}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }).catch(() => { });
}
