// src/setup/step-main-menu.ts — Step 2: Main configuration menu (loop until Done).

import { select } from "@inquirer/prompts";
import { c } from "@/setup/shared.ts";

export type MenuChoice = "vault" | "providers" | "channels" | "media" | "done";

export async function stepMainMenu(): Promise<MenuChoice> {
    console.log(`${c.cyan}${c.bold}  What would you like to configure?${c.reset}`);
    console.log("");

    return await select<MenuChoice>({
        message: "Choose an option",
        pageSize: 20,
        choices: [
            { value: "vault", name: `${c.bold}Vault Secrets${c.reset}    ${c.dim}— manage API keys & tokens (encrypted)${c.reset}` },
            { value: "providers", name: `${c.bold}Providers${c.reset}        ${c.dim}— LLM provider, model tier, agent name${c.reset}` },
            { value: "channels", name: `${c.bold}Channels${c.reset}         ${c.dim}— Telegram, Terminal, and more${c.reset}` },
            { value: "media", name: `${c.bold}Media & AI${c.reset}       ${c.dim}— embeddings, image/video gen${c.reset}` },
            { value: "done", name: `${c.green}${c.bold}✓ Done${c.reset}            ${c.dim}— save & exit setup${c.reset}` },
        ],
    });
}
