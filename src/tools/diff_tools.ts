// src/tools/diff_tools.ts
//
// Text and file diffing + patch application.
//
// Actions:
//   diff_text     — diff two strings, returns unified diff or summary of changes
//   diff_files    — diff two absolute file paths
//   apply_patch   — apply a unified diff patch string to a text, returns result
//   word_diff     — word-level diff (better for prose / config values)
//
// Uses the `diff` npm package (MyersDiff algorithm), same as git.

import { tool } from "ai";
import { z } from "zod";
import {
    createPatch,
    applyPatch,
    diffWords,
    diffLines,
    type Change,
} from "diff";
import { readFileSync, existsSync } from "node:fs";

export const IS_BOOTSTRAP_TOOL = false;

function summariseChanges(changes: Change[]): { added: number; removed: number; unchanged: number } {
    let added = 0, removed = 0, unchanged = 0;
    for (const c of changes) {
        const lines = (c.value.match(/\n/g) ?? []).length + (c.value.endsWith("\n") ? 0 : 1);
        if (c.added) added += lines;
        else if (c.removed) removed += lines;
        else unchanged += lines;
    }
    return { added, removed, unchanged };
}

export const diff_tools = tool({
    description:
        "Text and file diffing + patch application. " +
        "Actions: 'diff_text' (unified diff of two strings), 'diff_files' (unified diff of two file paths), " +
        "'apply_patch' (apply a unified diff to source text, returns patched result), " +
        "'word_diff' (word-level diff — better for prose, config values, JSON). " +
        "Returns unified diff format, change summary, and whether the patch applied cleanly.",
    inputSchema: z.object({
        action: z
            .enum(["diff_text", "diff_files", "apply_patch", "word_diff"])
            .describe("Operation to perform"),
        // diff_text / word_diff
        old_text: z.string().optional().describe("Original text (for diff_text, word_diff, apply_patch)"),
        new_text: z.string().optional().describe("New/modified text (for diff_text and word_diff)"),
        // diff_files
        old_file: z.string().optional().describe("Absolute path to the original file"),
        new_file: z.string().optional().describe("Absolute path to the modified file"),
        // apply_patch
        patch: z.string().optional().describe("Unified diff patch string to apply to old_text"),
        // shared
        context_lines: z
            .number()
            .int()
            .min(0)
            .max(20)
            .default(3)
            .describe("Lines of context around each change in unified diff (default 3)"),
        filename: z
            .string()
            .optional()
            .describe("Label used in the diff header (e.g. 'config.json'). Defaults to 'a' vs 'b'."),
    }),
    execute: async (input) => {
        try {
            switch (input.action) {
                // ── diff_text ────────────────────────────────────────────────
                case "diff_text": {
                    if (input.old_text === undefined || input.new_text === undefined) {
                        return { success: false, error: "old_text and new_text are required" };
                    }
                    const label = input.filename ?? "text";
                    const patch = createPatch(label, input.old_text, input.new_text, "", "", {
                        context: input.context_lines ?? 3,
                    });
                    const summary = summariseChanges(diffLines(input.old_text, input.new_text));
                    return { success: true, diff: patch, summary };
                }

                // ── diff_files ───────────────────────────────────────────────
                case "diff_files": {
                    if (!input.old_file || !input.new_file) {
                        return { success: false, error: "old_file and new_file are required" };
                    }
                    for (const f of [input.old_file, input.new_file]) {
                        if (!existsSync(f)) return { success: false, error: `File not found: ${f}` };
                    }
                    const oldText = readFileSync(input.old_file, "utf-8");
                    const newText = readFileSync(input.new_file, "utf-8");
                    const label = input.filename ?? input.old_file;
                    const patch = createPatch(label, oldText, newText, "", "", {
                        context: input.context_lines ?? 3,
                    });
                    const summary = summariseChanges(diffLines(oldText, newText));
                    return { success: true, diff: patch, summary };
                }

                // ── apply_patch ──────────────────────────────────────────────
                case "apply_patch": {
                    if (input.old_text === undefined || !input.patch) {
                        return { success: false, error: "old_text and patch are required" };
                    }
                    const result = applyPatch(input.old_text, input.patch);
                    if (result === false) {
                        return { success: false, error: "Patch did not apply cleanly — context mismatch" };
                    }
                    return { success: true, patched_text: result };
                }

                // ── word_diff ────────────────────────────────────────────────
                case "word_diff": {
                    if (input.old_text === undefined || input.new_text === undefined) {
                        return { success: false, error: "old_text and new_text are required" };
                    }
                    const changes = diffWords(input.old_text, input.new_text);
                    // Build an annotated representation: [-removed-] {+added+} unchanged
                    const annotated = changes
                        .map((c) => {
                            if (c.added) return `{+${c.value}+}`;
                            if (c.removed) return `[-${c.value}-]`;
                            return c.value;
                        })
                        .join("");
                    const added = changes.filter((c) => c.added).map((c) => c.value);
                    const removed = changes.filter((c) => c.removed).map((c) => c.value);
                    return { success: true, annotated, added_words: added, removed_words: removed };
                }

                default:
                    return { success: false, error: `Unknown action: ${input.action}` };
            }
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
