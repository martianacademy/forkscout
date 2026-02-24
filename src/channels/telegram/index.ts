// src/channels/telegram/index.ts — Telegram bot channel
import type { AppConfig } from "../../config.ts";
import { runAgent } from "../../agent/index.ts";
import { allTools } from "../../tools/index.ts";
import { sendMessage } from "./api.ts";

export async function startTelegram(config: AppConfig) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");

    console.log("[telegram] Starting long-poll...");

    let offset = 0;

    while (true) {
        try {
            const updates = await getUpdates(token, offset, config.telegram.pollingTimeout);

            for (const update of updates) {
                offset = update.update_id + 1;
                const msg = update.message;
                if (!msg?.text || msg.text.startsWith("/")) continue;

                const chatId = msg.chat.id;
                const text = msg.text;

                console.log(`[telegram] ${chatId}: ${text.slice(0, 80)}`);

                // Handle in background to not block polling
                handleMessage(config, token, chatId, text).catch((err) =>
                    console.error("[telegram] Handler error:", err)
                );
            }
        } catch (err) {
            console.error("[telegram] Poll error:", err);
            await sleep(3000);
        }
    }
}

async function handleMessage(
    config: AppConfig,
    token: string,
    chatId: number,
    text: string
) {
    try {
        const result = await runAgent(config, { userMessage: text }, allTools);

        if (result.text) {
            await sendMessage(token, chatId, result.text);
        }
    } catch (err: any) {
        console.error("[telegram] Agent error:", err.message);
        await sendMessage(token, chatId, `Error: ${err.message}`);
    }
}

async function getUpdates(
    token: string,
    offset: number,
    timeout: number
): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=["message"]`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 10) * 1000) });
    const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
    if (!data.ok) return [];
    return data.result;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

interface TelegramUpdate {
    update_id: number;
    message?: {
        chat: { id: number };
        text?: string;
        from?: { id: number; username?: string };
    };
}
