/**
 * CLI entry point for running Forkscout agent interactively
 */
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { PROJECT_ROOT } from './paths';

// Load .env from repo root (secrets only)
loadEnv({ path: resolve(PROJECT_ROOT, '.env') });

import { createAgent, type AgentConfig } from './index';
import { loadConfig, resolveApiKeyForProvider } from './config';

const cfg = loadConfig();
const config: AgentConfig = {
    llm: {
        provider: cfg.provider as any,
        model: cfg.model,
        baseURL: cfg.baseURL,
        apiKey: resolveApiKeyForProvider(cfg.provider),
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
    },
    maxIterations: cfg.agent.maxIterations,
    autoRegisterDefaultTools: cfg.agent.autoRegisterTools,
};

console.log('🤖 Forkscout Agent Configuration:');
console.log(`   Provider: ${config.llm.provider}`);
console.log(`   Model: ${config.llm.model}`);
console.log(`   Base URL: ${config.llm.baseURL}`);
console.log();

console.log('Starting Forkscout Agent (interactive mode)...\n');

import { finalizeGeneration } from './utils/generation-hooks';
import * as readline from 'readline';

createAgent(config)
    .then(async (agent) => {
        await agent.init();
        console.log('Forkscout Agent started. Type "exit" to quit, "clear" to reset memory.\n');

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        const promptUser = () => {
            rl.question('You: ', async (input) => {
                if (input.toLowerCase() === 'exit') {
                    await agent.stop();
                    rl.close();
                    return;
                }
                if (input.toLowerCase() === 'clear') {
                    await agent.getMemoryManager().clear();
                    console.log('Memory cleared.\n');
                    promptUser();
                    return;
                }
                try {
                    agent.saveToMemory('user', input);

                    // Create a per-request ToolLoopAgent via the centralized factory
                    const { agent: chatAgent, reasoningCtx } = await agent.createChatAgent({
                        userText: input,
                    });

                    const { text, usage, steps, output } = await chatAgent.generate({
                        prompt: input,
                    });

                    const { response: resolved } = await finalizeGeneration({
                        text, steps, usage, reasoningCtx,
                        modelId: 'cli', channel: 'terminal', agent,
                        userMessage: input, output: output as any,
                    });

                    console.log(`\n[Forkscout]: ${resolved}\n`);
                } catch (error) {
                    console.error('Error:', error);
                }
                promptUser();
            });
        };
        promptUser();
    })
    .catch(error => {
        console.error('Failed to start agent:', error);
        process.exit(1);
    });
