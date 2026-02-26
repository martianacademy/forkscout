// src/utils/n8n.ts — n8n workflow trigger utilities

import { getConfig } from "@/config.ts";

export interface N8nTriggerResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

/**
 * Trigger an n8n workflow by name.
 * 
 * Uses n8n's webhook trigger URL pattern:
 * POST {baseUrl}/webhook/{workflowName}
 * 
 * @param workflowName - Name of the n8n workflow (must match the webhook path)
 * @param payload - Optional data to send to the workflow
 * @returns Result with success status and response data
 */
export async function triggerN8nWorkflow(
    workflowName: string,
    payload?: Record<string, unknown>
): Promise<N8nTriggerResult> {
    const config = getConfig();
    const n8nConfig = config.n8n;

    if (!n8nConfig) {
        return { success: false, error: "n8n is not configured. Add n8n to your config." };
    }

    if (!n8nConfig.baseUrl) {
        return { success: false, error: "n8n baseUrl is not set in config." };
    }

    // Check workflow whitelist if configured
    if (n8nConfig.workflows && n8nConfig.workflows.length > 0) {
        if (!n8nConfig.workflows.includes(workflowName)) {
            return {
                success: false,
                error: `Workflow "${workflowName}" is not in the allowed list. Available: ${n8nConfig.workflows.join(", ")}`
            };
        }
    }

    // Build webhook URL - n8n uses /webhook/{name} and /webhook-test/{name} for testing
    const webhookUrl = `${n8nConfig.baseUrl}/webhook/${workflowName}`;

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: payload ? JSON.stringify(payload) : undefined,
        });

        // n8n returns 200 for success, but may return other codes
        if (!response.ok) {
            const errorText = await response.text();
            return {
                success: false,
                error: `n8n webhook returned ${response.status}: ${errorText || response.statusText}`
            };
        }

        // Try to parse JSON response, fallback to text
        const contentType = response.headers.get("content-type") || "";
        let data: unknown;
        
        if (contentType.includes("application/json")) {
            try {
                data = await response.json();
            } catch {
                data = await response.text();
            }
        } else {
            data = await response.text();
        }

        return { success: true, data };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to trigger n8n workflow: ${errorMessage}` };
    }
}

/**
 * Test an n8n webhook (uses the test URL which doesn't save data).
 * 
 * @param workflowName - Name of the n8n workflow
 * @param payload - Optional test data
 */
export async function testN8nWorkflow(
    workflowName: string,
    payload?: Record<string, unknown>
): Promise<N8nTriggerResult> {
    const config = getConfig();
    const n8nConfig = config.n8n;

    if (!n8nConfig?.baseUrl) {
        return { success: false, error: "n8n is not configured." };
    }

    const webhookUrl = `${n8nConfig.baseUrl}/webhook-test/${workflowName}`;

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload ? JSON.stringify(payload) : undefined,
        });

        if (!response.ok) {
            return { success: false, error: `Test failed: ${response.status}` };
        }

        const data = await response.json().catch(() => response.text());
        return { success: true, data };
    } catch (error) {
        return { success: false, error: String(error) };
    }
}
