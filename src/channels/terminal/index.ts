// src/channels/terminal/index.ts — Terminal chat channel
import * as readline from "readline";
import * as os from "os";
import { encode } from "gpt-tokenizer";
import type { ModelMessage } from "ai";
import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { streamAgent } from "@/agent/index.ts";
import { log } from "@/logs/logger.ts";
import { loadHistory, saveHistory, clearHistory } from "@/channels/chat-store.ts";

const logger = log("terminal");

export default {
    name: "terminal",
    start,
} satisfies Channel;

function countTokens(msg: ModelMessage): number {
    if (typeof msg.content === "string") return encode(msg.content).length;
    if (Array.isArray(msg.content)) {
        return msg.content.reduce((sum, part) => {
            if ("text" in part && typeof part.text === "string") return sum + encode(part.text).length;
            return sum + 256;
        }, 0);
    }
    return 0;
}

function trimHistory(history: ModelMessage[], tokenBudget: number): ModelMessage[] {
    let total = history.reduce((sum, m) => sum + countTokens(m), 0);
    let trimmed = [...history];
    while (total > tokenBudget && trimmed.length > 2) {
        const removed = trimmed.shift()!;
        total -= countTokens(removed);
    }
    // AI SDK requires the first message to be from 'user'.
    while (trimmed.length > 0 && (trimmed[0] as any).role !== "user") {
        trimmed.shift();
    }
    return trimmed;
}

async function start(config: AppConfig) {
    const sessionKey = `terminal-${os.userInfo().username}`;

    // Load history from disk — survives restarts
    let history: ModelMessage[] = loadHistory(sessionKey);
    if (history.length > 0) {
        log("terminal").info(`Resumed session for ${sessionKey} (${history.length} messages)`);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });

    logger.info(`\n${config.agent.name} — Terminal Chat`);
    logger.info('Type your message and press Enter. Ctrl+C to exit.\n');

    const ask = () => {
        rl.question("you > ", async (input) => {
            const text = input.trim();
            if (!text) return ask();

            if (text === "/clear") {
                history = [];
                clearHistory(sessionKey);
                logger.info("history cleared");
                return ask();
            }

            if (text === "/exit" || text === "/quit") {
                logger.info("Bye!");
                rl.close();
                process.exit(0);
            }

            process.stdout.write(`${config.agent.name.toLowerCase()} > `);

            try {
                const stream = await streamAgent(config, {
                    userMessage: text,
                    chatHistory: history,
                    meta: { channel: "terminal" },
                });

                // Stream tokens live to terminal
                for await (const chunk of stream.textStream) {
                    process.stdout.write(chunk);
                }
                process.stdout.write("\n\n");

                // Collect final messages for history, trim, persist
                const final = await stream.finalize();
                history = trimHistory(
                    [...history, { role: "user", content: text }, ...final.responseMessages],
                    config.terminal.historyTokenBudget
                );
                saveHistory(sessionKey, history);
            } catch (err: any) {
                logger.error(err.message);
            }

            ask();
        });
    };

    rl.on("close", () => {
        logger.info("Bye!");
        process.exit(0);
    });

    ask();
}
