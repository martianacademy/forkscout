/**
 * CLI entry point for running Forkscout agent interactively
 */
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';

// Load .env from repo root
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { createAgent, type AgentConfig } from './index';

const config: AgentConfig = {
    llm: {
        provider: (process.env.LLM_PROVIDER as any) || 'ollama',
        model: process.env.LLM_MODEL || 'gpt-oss:120b',
        baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000'),
    },
    maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS || '10'),
    autoRegisterDefaultTools: process.env.AGENT_AUTO_REGISTER_TOOLS !== 'false',
};

console.log('🤖 Forkscout Agent Configuration:');
console.log(`   Provider: ${config.llm.provider}`);
console.log(`   Model: ${config.llm.model}`);
console.log(`   Base URL: ${config.llm.baseURL}`);
console.log();

console.log('Starting Forkscout Agent (interactive mode)...\n');

import { generateText, stepCountIs } from 'ai';
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
                    const systemPrompt = await agent.buildSystemPrompt(input);
                    agent.saveToMemory('user', input);
                    const { text } = await generateText({
                        model: agent.getModel(),
                        system: systemPrompt,
                        prompt: input,
                        tools: agent.getTools(),
                        stopWhen: stepCountIs(6),
                    });
                    agent.saveToMemory('assistant', text);
                    console.log(`\n[Forkscout]: ${text}\n`);
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
