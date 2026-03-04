import { loadConfig } from "../src/config.ts";
import { buildAgentParams } from "../src/agent/build-params.ts";
import { encode } from "gpt-tokenizer";

const config = loadConfig();
const params = await buildAgentParams(config, {
    userMessage: "Hi",
    chatHistory: [],
    role: "owner",
    meta: { channel: "telegram", chatId: 961713986, sessionKey: "telegram-961713986" }
});

const systemTokens = encode(params.systemPrompt).length;
const toolDefs = JSON.stringify(Object.entries(params.tools).map(([name, t]) => ({
    name,
    desc: (t as any).description?.slice(0, 80),
    schema: (t as any).inputSchema,
})));
const toolTokens = encode(toolDefs).length;
const msgTokens = encode(JSON.stringify(params.messages)).length;

console.log("System prompt:   ", systemTokens, "tokens");
console.log("Tool definitions:", toolTokens, "tokens  ←", Object.keys(params.tools).length, "tools");
console.log("Messages:        ", msgTokens, "tokens");
console.log("TOTAL:           ", systemTokens + toolTokens + msgTokens, "tokens");
console.log("");
console.log("Top 10 heaviest tools:");
const toolWeights = Object.entries(params.tools).map(([name, t]) => ({
    name,
    tokens: encode(JSON.stringify({ name, desc: (t as any).description, schema: (t as any).inputSchema })).length,
})).sort((a, b) => b.tokens - a.tokens).slice(0, 10);
toolWeights.forEach(t => console.log(" ", t.tokens, "\t—", t.name));
