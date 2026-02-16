/**
 * Example: Custom tool creation
 */
import { createAgent } from '../src';

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

    // Register a custom tool
    const tools = agent.getToolRegistry();

    tools.register({
        name: 'get_current_time',
        description: 'Get the current time in ISO format',
        parameters: {},
        async execute(): Promise<string> {
            return new Date().toISOString();
        },
    });

    tools.register({
        name: 'calculate',
        description: 'Perform basic arithmetic calculation',
        parameters: {
            expression: {
                type: 'string',
                description: 'Math expression to evaluate (e.g., "2 + 2")',
            },
        },
        async execute(params: { expression: string }): Promise<number> {
            // Simple calculator (use with caution in production!)
            return eval(params.expression);
        },
    });

    // Use the custom tools
    console.log('Example: Using custom tools');
    await agent.processMessage('What time is it?');

    console.log('\n---\n');

    await agent.processMessage('Calculate 42 * 1337');

    await agent.stop();
}

main().catch(console.error);
