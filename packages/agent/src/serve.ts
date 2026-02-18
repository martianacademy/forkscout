/**
 * CLI entry point for running Forkscout agent as an HTTP API server
 */
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { PROJECT_ROOT } from './paths';

// Load .env from repo root (secrets only)
loadEnv({ path: resolve(PROJECT_ROOT, '.env') });

import { startServer } from './server';
import type { AgentConfig } from './index';
import { loadConfig, resolveApiKeyForProvider } from './config';
import { logStartup } from './activity-log';

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

console.log('🤖 Forkscout Agent API Server');
console.log(`   Provider: ${config.llm.provider}`);
console.log(`   Model: ${config.llm.model}`);
console.log(`   Base URL: ${config.llm.baseURL}`);

logStartup({
    provider: config.llm.provider,
    model: config.llm.model,
    baseURL: config.llm.baseURL,
    port: cfg.agent.port,
});

startServer(config, {
    port: cfg.agent.port,
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
