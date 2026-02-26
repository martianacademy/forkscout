// src/tools/analyze_image.ts
// Analyzes an image using a vision-capable model.
// Accepts a Telegram file_id (resolves via bot token) or a direct URL.
// Returns a detailed description including any text found in the image (OCR).

import { tool } from "ai";
import { generateText } from "ai";
import { z } from "zod";
import { getConfig } from "@/config.ts";
import { getModelForRole } from "@/providers/index.ts";

export const IS_BOOTSTRAP_TOOL = false;

export const analyze_image = tool({
    description:
        "Analyze or OCR an image. Accepts a Telegram file_id (from a photo message) or a direct image URL. " +
        "Returns a detailed description of the image, including any visible text transcribed exactly. " +
        "Use this whenever the user sends a photo, screenshot, or document image.",
    inputSchema: z.object({
        file_id: z
            .string()
            .optional()
            .describe("Telegram file_id — use the value from the [photo · ... · file_id: XXX] message"),
        url: z
            .string()
            .optional()
            .describe("Direct image URL (HTTPS). Use when file_id is not available."),
        prompt: z
            .string()
            .optional()
            .describe(
                "What to focus on. Default: full description + OCR of any visible text.",
            ),
    }),
    execute: async (input) => {
        const config = getConfig();

        // ── 1. Resolve image source ──────────────────────────────────────────
        let imageBuffer: ArrayBuffer;
        let mimeType = "image/jpeg";

        if (input.file_id) {
            const token = process.env.TELEGRAM_BOT_TOKEN;
            if (!token) return { success: false, error: "TELEGRAM_BOT_TOKEN env var is not set." };

            // Resolve file_id → file_path
            const fileRes = await fetch(
                `https://api.telegram.org/bot${token}/getFile?file_id=${input.file_id}`,
            );
            if (!fileRes.ok) {
                return { success: false, error: `Telegram getFile failed: ${fileRes.status}` };
            }
            const fileData = (await fileRes.json()) as {
                ok: boolean;
                result?: { file_path: string };
                description?: string;
            };
            if (!fileData.ok || !fileData.result) {
                return {
                    success: false,
                    error: fileData.description ?? "Could not resolve file_id to a download path.",
                };
            }

            const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
            const dlRes = await fetch(downloadUrl);
            if (!dlRes.ok) {
                return { success: false, error: `Failed to download image: ${dlRes.status}` };
            }
            mimeType = dlRes.headers.get("content-type") ?? "image/jpeg";
            imageBuffer = await dlRes.arrayBuffer();
        } else if (input.url) {
            const dlRes = await fetch(input.url);
            if (!dlRes.ok) {
                return { success: false, error: `Failed to download image from URL: ${dlRes.status}` };
            }
            mimeType = dlRes.headers.get("content-type") ?? "image/jpeg";
            imageBuffer = await dlRes.arrayBuffer();
        } else {
            return { success: false, error: "Provide either file_id or url." };
        }

        // ── 2. Call vision model ─────────────────────────────────────────────
        // Uses the `vision` role from the active provider (falls back to balanced).
        const model = getModelForRole("vision", config.llm);

        const analysisPrompt =
            input.prompt ??
            "Describe this image in full detail. If there is any text visible (signs, labels, documents, UI, code, etc.), transcribe it exactly word-for-word.";

        const { text } = await generateText({
            model,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "image",
                            image: imageBuffer,
                            mediaType: mimeType as `image/${string}`,
                        },
                        { type: "text", text: analysisPrompt },
                    ],
                },
            ],
            maxOutputTokens: config.browserAgent.maxTokens,
        });

        return { success: true, description: text };
    },
});
