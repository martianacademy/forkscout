/**
 * Example: Custom tool creation
 *
 * Shows how to add custom AI SDK tools to an agent and use them
 * via generateTextWithRetry (non-streaming).
 */
import { createAgent, generateTextWithRetry } from '../src';
import { tool, stopWhen, stepCountIs } from 'ai';
import { z } from 'zod';

const adminCtx = { isAdmin: true, channel: 'terminal' as const, sender: 'demo' };

async function main() {
    console.log('=== Custom Tool Example ===\n');

    // Create agent
    const agent = await createAgent({
        llm: {
            provider: 'ollama',
            model: 'qwen2.5-coder:32b',
            baseURL: 'http://host.docker.internal:11434/v1',
        },
    });

    // Define custom tools using AI SDK's tool() helper
    const customTools = {
        get_current_time: tool({
            description: 'Get the current time in ISO format',
            inputSchema: z.object({}),
            execute: async () => new Date().toISOString(),
        }),
        calculate: tool({
            description: 'Perform basic arithmetic calculation',
            inputSchema: z.object({
                expression: z.string().describe('Math expression to evaluate (e.g., "2 + 2")'),
            }),
            execute: async ({ expression }) => {
                // Simple calculator (use with caution in production!)
                return String(eval(expression));
            },
        }),
    };

    // Merge agent tools with custom tools
    const allTools = { ...agent.getTools(), ...customTools };

    async function chat(message: string) {
        const systemPrompt = await agent.buildSystemPrompt(message, adminCtx);
        agent.saveToMemory('user', message, adminCtx);

        const { text } = await generateTextWithRetry({
            model: agent.getModel(),
            system: systemPrompt,
            messages: [{ role: 'user', content: message }],
            tools: allTools,
            stopWhen: stepCountIs(10),
        });

        agent.saveToMemory('assistant', text);
        console.log(`Agent: ${text}\n`);
    }

    // Use the custom tools
    console.log('Example: Using custom tools');
    await chat('What time is it?');

    console.log('---\n');

    await chat('Calculate 42 * 1337');

    await agent.stop();
}

main().catch(console.error);
