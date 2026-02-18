import type { LLMConfig } from '../llm/client';
import type { McpConfig } from '../mcp/connector';

/**
 * Agent Configuration
 */
export interface AgentConfig {
    llm: LLMConfig;
    systemPrompt?: string;
    maxIterations?: number;
    autoRegisterDefaultTools?: boolean;
    /** Path to MCP config file, or inline config. Defaults to .forkscout/mcp.json */
    mcpConfig?: string | McpConfig;
}

/**
 * Agent State
 */
export interface AgentState {
    running: boolean;
    currentTask?: string;
    iterations: number;
}

/**
 * Chat Context — who is talking and through what medium.
 * Passed with every request so the agent knows its audience.
 */
export type ChatChannel = 'frontend' | 'terminal' | 'api' | 'telegram' | 'whatsapp' | 'discord' | 'slack' | 'unknown';

export interface ChatContext {
    /** The communication medium */
    channel: ChatChannel;
    /** Who is sending the message (name or identifier) */
    sender?: string;
    /** Whether this user is an authenticated admin */
    isAdmin: boolean;
    /** Optional extra metadata (e.g. chat ID, group name) */
    metadata?: Record<string, string>;
}
