/**
 * Example: Basic agent usage
 *
 * Demonstrates creating an agent, sending messages, and getting responses
 * using the generateTextWithRetry helper (non-streaming).
 */
import { createAgent, generateTextWithRetry } from '../src';
import { stopWhen, stepCountIs } from 'ai';

const adminCtx = { isAdmin: true, channel: 'terminal' as const, sender: 'demo' };

async function chat(agent: ReturnType<typeof createAgent> extends Promise<infer T> ? T : never, message: string) {
    const systemPrompt = await agent.buildSystemPrompt(message, adminCtx);
    agent.saveToMemory('user', message, adminCtx);

    const { text } = await generateTextWithRetry({
        model: agent.getModel(),
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
        tools: agent.getTools(),
        stopWhen: stepCountIs(10),
    });

    agent.saveToMemory('assistant', text);
    console.log(`Agent: ${text}\n`);
    return text;
}

async function main() {
    console.log('=== Forkscout Agent Example ===\n');

    // Create agent with Ollama (local LLM)
    const agent = await createAgent({
        llm: {
            provider: 'ollama',
            model: 'qwen2.5-coder:32b',
            baseURL: 'http://host.docker.internal:11434/v1',
            temperature: 0.7,
        },
        autoRegisterDefaultTools: true,
    });

    // Example interactions
    console.log('Example 1: Simple conversation');
    await chat(agent, 'Hello! What can you do?');

    console.log('---\n');

    console.log('Example 2: Web search');
    await chat(agent, 'Search for the latest cryptocurrency news');

    console.log('---\n');

    console.log('Example 3: Memory recall');
    await chat(agent, 'What did I just ask you about?');

    // Stop the agent
    await agent.stop();
}

main().catch(console.error);
