import type { z } from 'zod';

/**
 * Tool definition
 */
export interface Tool {
    name: string;
    description: string;
    parameters: z.ZodObject<any>;
    execute: (params: any) => Promise<any>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: Record<string, any>;
}

/**
 * Tool Registry - Manages available tools for the agent
 */
export class ToolRegistry {
    private tools = new Map<string, Tool>();

    register(tool: Tool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool ${tool.name} already registered`);
        }
        this.tools.set(tool.name, tool);
        console.log(`Tool registered: ${tool.name}`);
    }

    unregister(name: string): boolean {
        const existed = this.tools.delete(name);
        if (existed) {
            console.log(`Tool unregistered: ${name}`);
        }
        return existed;
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    list(): Tool[] {
        return Array.from(this.tools.values());
    }

    async execute(name: string, parameters: Record<string, any>): Promise<ToolResult> {
        const tool = this.tools.get(name);

        if (!tool) {
            return {
                success: false,
                error: `Tool ${name} not found`,
            };
        }

        try {
            const result = await tool.execute(parameters);
            return {
                success: true,
                data: result,
                metadata: {
                    toolName: name,
                    executedAt: new Date().toISOString(),
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    toolName: name,
                    executedAt: new Date().toISOString(),
                },
            };
        }
    }
}
