// src/tools/secret_vault_tools.ts — Manage named secrets. Secrets stored encrypted,
// NEVER passed to LLM. Use {{secret:alias}} placeholders in all tool inputs.
import { tool } from "ai";
import { z } from "zod";
import { setSecret, listAliases, deleteSecret, getSecret } from "@/secrets/vault.ts";

export const IS_BOOTSTRAP_TOOL = false;

export const secret_vault_tools = tool({
    description:
        "Manage named secrets in the encrypted vault. " +
        "Use store_secret to save a password/key under an alias. " +
        "After storing, use {{secret:alias}} as a placeholder in any tool input — " +
        "the actual value is injected at runtime and NEVER shown to the LLM. " +
        "Actions: store | list | delete | verify",
    inputSchema: z.object({
        action: z
            .enum(["store", "list", "delete", "verify"])
            .describe("store=save new secret, list=show aliases, delete=remove, verify=check alias exists"),
        alias: z
            .string()
            .optional()
            .describe("Short name for the secret, e.g. 'db_pass', 'my_api_key'"),
        value: z
            .string()
            .optional()
            .describe("The actual secret value to store (only for action=store)"),
    }),
    execute: async (input) => {
        switch (input.action) {
            case "store": {
                if (!input.alias || !input.value) {
                    return { success: false, error: "alias and value are required for store action" };
                }
                const alias = input.alias.trim().toLowerCase().replace(/\s+/g, "_");
                setSecret(alias, input.value);
                // IMPORTANT: never echo the value back — only confirm storage
                return {
                    success: true,
                    message: `Secret stored as alias '${alias}'. Use {{secret:${alias}}} in any tool input.`,
                    alias,
                    placeholder: `{{secret:${alias}}}`,
                };
            }

            case "list": {
                const aliases = listAliases();
                return {
                    success: true,
                    aliases,
                    count: aliases.length,
                    usage: "Use {{secret:<alias>}} as a placeholder in tool inputs.",
                };
            }

            case "delete": {
                if (!input.alias) return { success: false, error: "alias is required for delete action" };
                const deleted = deleteSecret(input.alias.trim());
                return deleted
                    ? { success: true, message: `Secret '${input.alias}' deleted.` }
                    : { success: false, error: `Alias '${input.alias}' not found in vault.` };
            }

            case "verify": {
                if (!input.alias) return { success: false, error: "alias is required for verify action" };
                const exists = getSecret(input.alias.trim()) !== null;
                return { success: true, exists, alias: input.alias };
            }
        }
    },
});
