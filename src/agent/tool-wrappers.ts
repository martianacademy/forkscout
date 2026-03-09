// src/agent/tool-wrappers.ts — Per-tool safety, secret, and progress wrappers
import { log } from "@/logs/logger.ts";
import { resolveSecrets, censorSecrets } from "@/secrets/vault.ts";

const logger = log("agent");

// ── Error safety net ──────────────────────────────────────────────────────────
// Catches any uncaught exception from tool execute() and returns a structured
// error object instead of throwing. The LLM sees the error and can fix/retry.

export function wrapToolsWithErrorSafetyNet(
    tools: Record<string, any>
): Record<string, any> {
    return Object.fromEntries(
        Object.entries(tools).map(([name, t]) => {
            if (typeof t.execute !== "function") return [name, t];
            const original = t.execute;
            return [name, {
                ...t,
                execute: async (input: any) => {
                    try {
                        return await original(input);
                    } catch (err: any) {
                        const message = err?.message ?? String(err);
                        const stack = err?.stack?.split("\n").slice(0, 3).join("\n") ?? "";
                        logger.error(`[tool-error] ${name}: ${message}`);
                        return {
                            success: false,
                            tool: name,
                            error: message,
                            errorType: err?.constructor?.name ?? "Error",
                            stackPreview: stack,
                            hint: classifyToolError(name, message),
                        };
                    }
                },
            }];
        })
    );
}

/** Quick heuristic to give the agent a starting point for what to do. */
function classifyToolError(toolName: string, message: string): string {
    const m = message.toLowerCase();
    if (m.includes("enoent") || m.includes("no such file")) return "File not found — check the path.";
    if (m.includes("eacces") || m.includes("permission denied")) return "Permission denied — try with different permissions or a different approach.";
    if (m.includes("econnrefused") || m.includes("enotfound")) return "Network/service unreachable — check the URL or if the service is running.";
    if (m.includes("timeout") || m.includes("etimedout")) return "Operation timed out — try again or use a shorter timeout.";
    if (m.includes("syntax error") || m.includes("unexpected token")) return "Code syntax error in tool — read the tool source and fix, or create a replacement.";
    if (m.includes("is not a function") || m.includes("is not defined")) return "Code bug in tool — a function or variable is missing. Read the tool source to fix.";
    if (m.includes("cannot read properties of") || m.includes("undefined")) return "Null reference in tool code — read the source, check for missing data.";
    if (m.includes("out of memory") || m.includes("heap")) return "Out of memory — try processing less data at once.";
    if (m.includes("spawn") || m.includes("command not found")) return "System command not found — check if the program is installed.";
    return "Read the tool source file to understand and fix the error, or create a new tool if unrecoverable.";
}

// ── Secret handling wrap ──────────────────────────────────────────────────────
// 1. RESOLVE: replace {{secret:alias}} in all string inputs before execution
// 2. CENSOR:  replace known secret values in outputs before they reach the LLM

export function wrapToolsWithSecretHandling(tools: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
        Object.entries(tools).map(([name, t]) => {
            if (name === "secret_vault_tools" || typeof t.execute !== "function") {
                return [name, t];
            }
            const original = t.execute;
            return [name, {
                ...t,
                execute: async (input: any) => {
                    let resolvedInput = input;
                    try {
                        const inputStr = JSON.stringify(input);
                        if (inputStr.includes("{{secret:")) {
                            resolvedInput = JSON.parse(
                                inputStr.replace(
                                    /\{\{secret:([a-zA-Z0-9_\-]+)\}\}/g,
                                    (_, alias) => {
                                        const val = resolveSecrets(`{{secret:${alias}}}`);
                                        return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                                    }
                                )
                            );
                        }
                    } catch (err: any) {
                        // Secret not found — surface the error to the LLM instead of silently
                        // passing the placeholder string as a literal value to the tool.
                        logger.warn(`[secret-wrap] ${name}: secret resolution failed: ${err?.message ?? err}`);
                        return {
                            success: false,
                            error: err?.message ?? String(err),
                            hint: "Check the alias exists with: call_tool('secret_vault_tools', { action: 'list' }). Store missing secrets with: call_tool('secret_vault_tools', { action: 'store', alias: '<alias>', value: '<value>' })",
                        };
                    }

                    const result = await original(resolvedInput);

                    try {
                        const raw = typeof result === "string" ? result : JSON.stringify(result);
                        const censored = censorSecrets(raw);
                        if (censored !== raw) {
                            logger.warn(`[secret-wrap] ${name}: censored secret value from tool output`);
                            return typeof result === "string" ? censored : JSON.parse(censored);
                        }
                    } catch { /* don't break the tool if censor fails */ }

                    return result;
                },
            }];
        })
    );
}

// ── Progress hook wrap ────────────────────────────────────────────────────────
// Fires onToolCall before each tool executes so the channel can show live progress.

export function wrapToolsWithProgress(
    tools: Record<string, any>,
    onToolCall: (name: string, input: unknown) => void | Promise<void>
): Record<string, any> {
    return Object.fromEntries(
        Object.entries(tools).map(([name, t]) => {
            if (typeof t.execute !== "function") return [name, t];
            const original = t.execute;
            return [name, {
                ...t,
                execute: async (input: any) => {
                    try { await onToolCall(name, input); } catch { /* never block tool on hook error */ }
                    return original(input);
                },
            }];
        })
    );
}
