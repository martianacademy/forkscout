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

import { stepCountIs } from 'ai';
import { generateTextWithRetry } from './llm/retry';
import type { ModelTier } from './llm/router';
import { createReasoningContext, createPrepareStep, getReasoningSummary } from './llm/reasoning';
import { buildFailureObservation } from './memory';
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
                    const { model: cliModel, tier: cliTier, complexity: cliComplexity } = agent.getModelForChat(input);

                    const cliReasoningCtx = createReasoningContext(
                        input,
                        cliComplexity,
                        cliTier as ModelTier,
                        systemPrompt,
                        agent.getRouter(),
                    );

                    const { text, usage } = await generateTextWithRetry({
                        model: cliModel,
                        system: systemPrompt,
                        prompt: input,
                        tools: agent.getTools(),
                        stopWhen: stepCountIs(20),
                        prepareStep: createPrepareStep(cliReasoningCtx),
                    });

                    // Log reasoning summary
                    const cliSummary = getReasoningSummary(cliReasoningCtx);
                    if (cliSummary.escalated || cliSummary.toolFailures > 0) {
                        console.log(`[Reasoning]: tier=${cliSummary.finalTier}, failures=${cliSummary.toolFailures}, escalated=${cliSummary.escalated}`);
                    }

                    // Record cost (use final tier in case of escalation)
                    if (usage) {
                        agent.getRouter().recordUsage(cliReasoningCtx.tier, usage.inputTokens || 0, usage.outputTokens || 0);
                    }

                    // Learn from failures
                    const cliFailureObs = buildFailureObservation(cliReasoningCtx, text || '');
                    if (cliFailureObs) {
                        try { agent.getMemoryManager().recordSelfObservation(cliFailureObs, 'failure-learning'); } catch { /* non-critical */ }
                    }

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
