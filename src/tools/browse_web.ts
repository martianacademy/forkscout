import { tool } from "ai";
import { z } from "zod";
import { getConfig } from "@/config.ts";

export const IS_BOOTSTRAP_TOOL = true;

export const browse_web = tool({
    description: "Fetch and read the text content of a web page",
    inputSchema: z.object({
        url: z.string().describe("URL of the page to browse"),
    }),
    execute: async (input) => {
        try {
            const res = await fetch(input.url, {
                headers: { "User-Agent": `Mozilla/5.0 (compatible; ${getConfig().agent.name.toLowerCase()}-agent/3.0)` },
            });
            const html = await res.text();

            const text = html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim()
                .slice(0, 8000);

            return { success: true, content: text, statusCode: res.status };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
