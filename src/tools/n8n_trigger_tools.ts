// src/tools/n8n_trigger_tools.ts
import { tool } from "ai";
import { z } from "zod";
import { getConfig } from "@/config.ts";
import { triggerN8nWorkflow, testN8nWorkflow } from "@/utils/n8n.ts";

export const IS_BOOTSTRAP_TOOL = false;

/**
 * Get list of allowed n8n workflows from config.
 */
function getAllowedWorkflows(): string[] {
    const config = getConfig();
    return config.n8n?.workflows || [];
}

/**
 * Check if n8n is configured.
 */
function isN8nConfigured(): boolean {
    const config = getConfig();
    return !!(config.n8n?.baseUrl);
}

export const n8n_trigger_workflow_tools = tool({
    description: "Trigger an n8n workflow by name. Use this to run automations you've set up in n8n. Check config for available workflows.",
    inputSchema: z.object({
        workflow_name: z.string().describe("Name of the n8n workflow to trigger (must match the webhook path)"),
        payload: z.record(z.string(), z.unknown()).optional().describe("Optional JSON data to send to the workflow"),
        test: z.boolean().optional().describe("If true, uses the test webhook URL (doesn't save data). Default: false"),
    }),
    execute: async (input) => {
        const { workflow_name, payload, test } = input;

        // Check if n8n is configured
        if (!isN8nConfigured()) {
            return {
                success: false,
                error: "n8n is not configured. Ask the owner to add n8n.baseUrl to the config.",
                available_workflows: []
            };
        }

        const allowed = getAllowedWorkflows();
        
        // If workflows are whitelisted, show them
        if (allowed.length > 0) {
            if (!allowed.includes(workflow_name)) {
                return {
                    success: false,
                    error: `Workflow "${workflow_name}" not in allowed list.`,
                    allowed_workflows: allowed
                };
            }
        }

        // Trigger the workflow
        const result = test 
            ? await testN8nWorkflow(workflow_name, payload)
            : await triggerN8nWorkflow(workflow_name, payload);

        return {
            success: result.success,
            workflow: workflow_name,
            test_mode: test || false,
            ...(result.success 
                ? { data: result.data }
                : { error: result.error }
            ),
            available_workflows: allowed.length > 0 ? allowed : undefined
        };
    }
});

export const n8n_list_workflows_tools = tool({
    description: "List available n8n workflows from config. Use this to see what automations can be triggered.",
    inputSchema: z.object({}),
    execute: async () => {
        if (!isN8nConfigured()) {
            return {
                configured: false,
                error: "n8n is not configured. Add n8n.baseUrl to your config."
            };
        }

        const config = getConfig();
        const workflows = getAllowedWorkflows();

        return {
            configured: true,
            base_url: config.n8n?.baseUrl,
            workflows: workflows.length > 0 
                ? workflows 
                : "No whitelist configured — any workflow name can be triggered"
        };
    }
});
