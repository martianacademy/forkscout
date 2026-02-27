// src/tools/pdf_tools.ts
//
// PDF text extraction tool.
//
// Reads a local file path or fetches a remote URL, extracts all text content,
// and returns it as a plain string — no formatting artifacts, ready to read
// or pass to another tool.
//
// Also exposes page-level extraction so you can pull just the pages you need
// from large documents without hitting token limits.

import { tool } from "ai";
import { z } from "zod";
import * as pdfParseModule from "pdf-parse";
const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
import { readFileSync, existsSync } from "node:fs";

export const IS_BOOTSTRAP_TOOL = false;

const DEFAULT_TIMEOUT_MS = 30_000;

async function loadPdfBuffer(source: string): Promise<Buffer> {
    if (source.startsWith("http://") || source.startsWith("https://")) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        try {
            const res = await fetch(source, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const ab = await res.arrayBuffer();
            return Buffer.from(ab);
        } finally {
            clearTimeout(timer);
        }
    }
    if (!existsSync(source)) throw new Error(`File not found: ${source}`);
    return readFileSync(source);
}

export const pdf_tools = tool({
    description:
        "Extract text content from a PDF file or URL. " +
        "Returns clean plain text, page count, and metadata (title, author, etc.). " +
        "Use 'page_start'/'page_end' to extract a subset of pages and avoid token overload on large documents. " +
        "Source can be an absolute file path or an https:// URL to a PDF.",
    inputSchema: z.object({
        source: z
            .string()
            .describe("Absolute file path or https:// URL of the PDF"),
        page_start: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("First page to include (1-based). Omit to start from page 1."),
        page_end: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("Last page to include (1-based). Omit to include all pages."),
        max_chars: z
            .number()
            .int()
            .min(100)
            .max(100_000)
            .default(20_000)
            .describe("Max characters of text to return (default 20000)"),
    }),
    execute: async (input) => {
        let buffer: Buffer;
        try {
            buffer = await loadPdfBuffer(input.source);
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }

        let parsed: Awaited<ReturnType<typeof pdfParse>>;
        try {
            parsed = await pdfParse(buffer);
        } catch (err: any) {
            return { success: false, error: `PDF parse failed: ${(err as Error).message}` };
        }

        const totalPages = parsed.numpages;
        let text = parsed.text ?? "";

        // Page slicing: pdf-parse inserts form feeds (\f) between pages
        if (input.page_start !== undefined || input.page_end !== undefined) {
            const pages = text.split("\f");
            const start = Math.max(0, (input.page_start ?? 1) - 1);
            const end = Math.min(pages.length, input.page_end ?? pages.length);
            text = pages.slice(start, end).join("\n\n---\n\n");
        }

        const maxChars = input.max_chars ?? 20_000;
        const truncated = text.length > maxChars;
        text = text.slice(0, maxChars).trim();

        return {
            success: true,
            total_pages: totalPages,
            text,
            truncated,
            chars: text.length,
            metadata: {
                title: parsed.info?.Title ?? null,
                author: parsed.info?.Author ?? null,
                creator: parsed.info?.Creator ?? null,
                pdf_version: parsed.info?.PDFFormatVersion ?? null,
            },
        };
    },
});
