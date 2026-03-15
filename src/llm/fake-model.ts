import type { LanguageModel } from "ai";
import { log } from "@/logs/logger.ts";

const logger = log("fake-llm");

export const fakeModel = {
    specificationVersion: "v1",
    provider: "fake",
    modelId: "fake-test-model",
    defaultObjectGenerationMode: "json",
    async doGenerate(options: any) {
        logger.info(`[FAKE_LLM] received prompt with ${options.prompt.length} messages.`);
        for (let i = 0; i < options.prompt.length; i++) {
            const m = options.prompt[i];
            const preview = typeof m.content === "string"
                ? m.content.slice(0, 120)
                : JSON.stringify(m.content).slice(0, 200);
            logger.info(`  [${i}] role=${m.role} content=${preview}`);
        }
        
        return {
            text: `[FAKE_LLM] Mock response to prompt of length ${options.prompt.length}`,
            toolCalls: [],
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 10 },
            rawCall: { rawPrompt: null, rawSettings: {} },
        };
    },
    async doStream() {
        throw new Error("Stream not implemented in FakeLLM");
    }
} as unknown as LanguageModel;
