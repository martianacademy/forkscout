/**
 * CLI entry point for running Forkscout agent as an HTTP API server
 */
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';

// Load .env from repo root
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { startServer } from './server';
import type { AgentConfig } from './index';

const config: AgentConfig = {
    llm: {
        provider: (process.env.LLM_PROVIDER as any) || 'ollama',
        model: process.env.LLM_MODEL || 'gpt-oss:120b',
        baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
        apiKey: process.env.LLM_API_KEY || '',
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000'),
    },
    maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS || '10'),
    autoRegisterDefaultTools: process.env.AGENT_AUTO_REGISTER_TOOLS !== 'false',
};

console.log('🤖 Forkscout Agent API Server');
console.log(`   Provider: ${config.llm.provider}`);
console.log(`   Model: ${config.llm.model}`);
console.log(`   Base URL: ${config.llm.baseURL}`);

startServer(config, {
    port: parseInt(process.env.AGENT_PORT || '3210'),
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
