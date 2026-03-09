// src/tools/clipboard_tools.ts
// Read from and write to the system clipboard.
// macOS: pbpaste / pbcopy  |  Linux: xclip -selection clipboard  |  WSL: clip.exe / powershell

import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";

const clipboardSchema = z.object({
    action: z.enum(["read", "write"]).describe("'read' to get clipboard contents, 'write' to set them"),
    text: z.string().optional().describe("Text to write to clipboard (required when action='write')"),
});

function platform(): "mac" | "linux" | "wsl" | "unknown" {
    const p = process.platform;
    if (p === "darwin") return "mac";
    if (p === "linux") {
        try { execSync("which clip.exe", { stdio: "ignore" }); return "wsl"; } catch { /* noop */ }
        return "linux";
    }
    return "unknown";
}

function readClipboard(): string {
    const p = platform();
    if (p === "mac") return execSync("pbpaste", { encoding: "utf8" });
    if (p === "wsl") return execSync("powershell.exe -command Get-Clipboard", { encoding: "utf8" }).trim();
    if (p === "linux") {
        // try xclip, then xsel
        try { return execSync("xclip -selection clipboard -o", { encoding: "utf8" }); } catch { /* noop */ }
        return execSync("xsel --clipboard --output", { encoding: "utf8" });
    }
    throw new Error("Unsupported platform for clipboard access");
}

function writeClipboard(text: string): void {
    const p = platform();
    if (p === "mac") {
        execSync("pbcopy", { input: text });
        return;
    }
    if (p === "wsl") {
        execSync("clip.exe", { input: text });
        return;
    }
    if (p === "linux") {
        try { execSync("xclip -selection clipboard", { input: text }); return; } catch { /* noop */ }
        execSync("xsel --clipboard --input", { input: text });
        return;
    }
    throw new Error("Unsupported platform for clipboard access");
}

export const clipboard_tools = tool({
    description:
        "Read from or write to the system clipboard. " +
        "Use action='read' to get the current clipboard contents. " +
        "Use action='write' with text= to copy text to the clipboard.",
    inputSchema: clipboardSchema,
    execute: async (input) => {
        const { action, text } = input;
        try {
            if (action === "read") {
                const content = readClipboard();
                return { success: true, content, length: content.length };
            }
            if (action === "write") {
                if (text === undefined) return { success: false, error: "text is required for action='write'" };
                writeClipboard(text);
                return { success: true, written: text.length };
            }
            return { success: false, error: "Invalid action" };
        } catch (err) {
            return { success: false, error: (err as Error).message };
        }
    },
});
