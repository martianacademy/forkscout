/**
 * Example: Basic agent usage
 */
import { createAgent } from '../src';

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
    await agent.processMessage('Hello! What can you do?');

    console.log('\n---\n');

    console.log('Example 2: Web search');
    await agent.processMessage('Search for the latest cryptocurrency news');

    console.log('\n---\n');

    console.log('Example 3: Memory recall');
    await agent.processMessage('What did I just ask you about?');

    // Stop the agent
    await agent.stop();
}

main().catch(console.error);
