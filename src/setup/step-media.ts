// src/setup/step-media.ts — Media & AI capabilities menu (embeddings, image/video gen).

import { select } from "@inquirer/prompts";
import { c } from "@/setup/shared.ts";
import { loadConfigFile } from "@/setup/env-helpers.ts";
import { stepEmbeddings } from "@/setup/step-embeddings.ts";
import { stepImageGen } from "@/setup/step-image-gen.ts";
import { stepVideoGen } from "@/setup/step-video-gen.ts";

function badge(enabled: boolean | undefined): string {
    return enabled ? `${c.green}✓ on${c.reset}` : `${c.dim}○ off${c.reset}`;
}

export async function stepMedia(): Promise<void> {
    while (true) {
        const cfg = loadConfigFile();

        console.log(`${c.cyan}${c.bold}  Media & AI${c.reset}`);
        console.log(`${c.cyan}  ${"━".repeat(40)}${c.reset}\n`);

        const choice = await select<string>({
            message: "Configure media capabilities",
            pageSize: 20,
            choices: [
                { value: "__back__", name: `${c.green}← Back${c.reset}     ${c.dim}return to main menu${c.reset}` },
                {
                    value: "embeddings",
                    name: `${"Embeddings".padEnd(24)} ${badge(cfg?.embeddings?.enabled)}`,
                    description: "Vector embeddings for semantic search/memory",
                },
                {
                    value: "image",
                    name: `${"Image Generation".padEnd(24)} ${badge(cfg?.imageGeneration?.enabled)}`,
                    description: "DALL-E, Flux, Stable Diffusion, etc.",
                },
                {
                    value: "video",
                    name: `${"Video Generation".padEnd(24)} ${badge(cfg?.videoGeneration?.enabled)}`,
                    description: "Minimax, Runway, Kling, Pika, etc.",
                },
            ],
        });

        if (choice === "__back__") { console.log(""); return; }
        console.log("");

        if (choice === "embeddings") await stepEmbeddings();
        else if (choice === "image") await stepImageGen();
        else if (choice === "video") await stepVideoGen();
    }
}
