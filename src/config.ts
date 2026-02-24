// src/config.ts — Config loader
import { readFileSync } from "fs";
import { resolve } from "path";

export interface LLMConfig {
    model: string;
    maxTokens: number;
    maxSteps: number;
}

export interface AgentConfig {
    systemPrompt: string;
}

export interface McpServerConfig {
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
}

export interface AppConfig {
    telegram: {
        pollingTimeout: number;
    };
    llm: LLMConfig;
    agent: AgentConfig;
    mcp: {
        servers: Record<string, McpServerConfig>;
    };
}

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
    if (_config) return _config;

    const configPath = resolve(process.cwd(), "forkscout.config.json");
    const raw = readFileSync(configPath, "utf-8");
    _config = JSON.parse(raw) as AppConfig;
    return _config;
}

export function getConfig(): AppConfig {
    if (!_config) return loadConfig();
    return _config;
}
