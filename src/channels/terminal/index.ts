// src/channels/terminal/index.ts — Terminal chat channel
import * as readline from "readline";
import * as os from "os";
import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { streamAgent } from "@/agent/index.ts";
import { LLMError } from "@/llm/index.ts";
import { log } from "@/logs/logger.ts";
import { buildChatHistory, saveSemanticTurn, extractToolsUsed, clearSemanticHistory, loadSemanticTurns } from "@/channels/semantic-store.ts";

const logger = log("terminal");

export default {
    name: "terminal",
    start,
} satisfies Channel;

async function start(config: AppConfig) {
    const sessionKey = `terminal-${os.userInfo().username}`;
    const turns = loadSemanticTurns(sessionKey);
    if (turns.length > 0) log("terminal").info(`Resumed session for ${sessionKey} (${turns.length} turns)`);

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
                clearSemanticHistory(sessionKey);
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
                    chatHistory: buildChatHistory(sessionKey),
                    role: "owner",
                    meta: { channel: "terminal", sessionKey },
                });

                // Stream tokens live to terminal
                for await (const chunk of stream.textStream) {
                    process.stdout.write(chunk);
                }
                process.stdout.write("\n\n");

                const final = await stream.finalize();
                saveSemanticTurn(sessionKey, {
                    ts: Date.now(),
                    user: text,
                    assistant: final.text?.trim() ?? "",
                    tools: extractToolsUsed(final.responseMessages),
                });
            } catch (err: any) {
                if (err instanceof LLMError) {
                    console.error(`\n\x1b[31m${err.classified.userMessage}\x1b[0m`);
                    logger.error(`[${err.classified.category}] ${(err.classified.original as any)?.message ?? err.message}`);
                } else {
                    console.error(`\n\x1b[31mError: ${err.message}\x1b[0m`);
                    logger.error(err.message);
                }
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
