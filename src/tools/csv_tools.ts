// src/tools/csv_tools.ts
//
// CSV parse, query, filter, transform, and write — zero extra deps.
//
// Actions:
//   parse        — CSV text → array of row objects (headers as keys)
//   read_file    — read a CSV file, return rows
//   write_file   — write rows (array of objects) to a CSV file
//   filter       — return rows where a column matches a value or regex
//   aggregate    — count, sum, avg, min, max a numeric column (with optional groupBy)
//   to_json      — CSV text → pretty JSON string
//   from_json    — JSON array of objects → CSV text
//
// Handles quoted fields, commas inside quotes, and Windows CRLF line endings.

import { tool } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const IS_BOOTSTRAP_TOOL = false;

// ── Core CSV parser ────────────────────────────────────────────────────────────

function parseCsvText(text: string, delimiter = ","): Record<string, string>[] {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
    if (lines.length === 0) return [];

    const parseRow = (line: string): string[] => {
        const fields: string[] = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') inQuotes = false;
                else cur += ch;
            } else {
                if (ch === '"') { inQuotes = true; }
                else if (ch === delimiter) { fields.push(cur); cur = ""; }
                else cur += ch;
            }
        }
        fields.push(cur);
        return fields;
    };

    const headers = parseRow(lines[0]);
    return lines.slice(1).filter((l) => l.trim()).map((line) => {
        const values = parseRow(line);
        return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    });
}

function rowsToCsv(rows: Record<string, string>[], delimiter = ","): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    const escape = (v: string) => (v.includes(delimiter) || v.includes('"') || v.includes("\n"))
        ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [
        headers.map(escape).join(delimiter),
        ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(delimiter)),
    ];
    return lines.join("\n");
}

export const csv_tools = tool({
    description:
        "Parse, filter, aggregate, and write CSV data — no dependencies. " +
        "Actions: 'parse' (CSV text → rows), 'read_file' (file path → rows), " +
        "'write_file' (rows → file), 'filter' (rows where column matches value/regex), " +
        "'aggregate' (count/sum/avg/min/max a numeric column, optional groupBy), " +
        "'to_json' (CSV text → JSON), 'from_json' (JSON array → CSV text). " +
        "All row data is returned as arrays of objects with column headers as keys.",
    inputSchema: z.object({
        action: z
            .enum(["parse", "read_file", "write_file", "filter", "aggregate", "to_json", "from_json"])
            .describe("Operation to perform"),
        // text input
        csv_text: z.string().optional().describe("Raw CSV text (for parse, filter, aggregate, to_json)"),
        // file ops
        file_path: z.string().optional().describe("Absolute file path (for read_file and write_file)"),
        rows: z
            .array(z.record(z.string(), z.string()))
            .optional()
            .describe("Array of row objects to write or convert (for write_file and from_json)"),
        // filter
        column: z.string().optional().describe("Column name to filter or aggregate on"),
        value: z.string().optional().describe("Value to match for filter (exact or regex if is_regex=true)"),
        is_regex: z.boolean().optional().describe("Treat value as a regex pattern for filter"),
        // aggregate
        operation: z
            .enum(["count", "sum", "avg", "min", "max"])
            .optional()
            .describe("Aggregation operation"),
        group_by: z.string().optional().describe("Column to group by for aggregate"),
        // shared
        delimiter: z.string().max(1).default(",").describe("CSV delimiter character (default ',')"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(10_000)
            .optional()
            .describe("Max rows to return (omit for all rows)"),
    }),
    execute: async (input) => {
        try {
            const delim = input.delimiter ?? ",";

            // ── helpers ─────────────────────────────────────────────────────
            const getRows = (): Record<string, string>[] => {
                if (input.csv_text) return parseCsvText(input.csv_text, delim);
                if (input.file_path) {
                    if (!existsSync(input.file_path))
                        throw new Error(`File not found: ${input.file_path}`);
                    return parseCsvText(readFileSync(input.file_path, "utf-8"), delim);
                }
                throw new Error("csv_text or file_path is required");
            };

            switch (input.action) {
                // ── parse ────────────────────────────────────────────────────
                case "parse": {
                    if (!input.csv_text) return { success: false, error: "csv_text is required" };
                    const rows = parseCsvText(input.csv_text, delim);
                    const limited = input.limit ? rows.slice(0, input.limit) : rows;
                    return { success: true, row_count: rows.length, columns: Object.keys(rows[0] ?? {}), rows: limited };
                }

                // ── read_file ────────────────────────────────────────────────
                case "read_file": {
                    if (!input.file_path) return { success: false, error: "file_path is required" };
                    const rows = getRows();
                    const limited = input.limit ? rows.slice(0, input.limit) : rows;
                    return { success: true, row_count: rows.length, columns: Object.keys(rows[0] ?? {}), rows: limited };
                }

                // ── write_file ───────────────────────────────────────────────
                case "write_file": {
                    if (!input.file_path) return { success: false, error: "file_path is required" };
                    if (!input.rows?.length) return { success: false, error: "rows is required and must not be empty" };
                    mkdirSync(dirname(input.file_path), { recursive: true });
                    const csv = rowsToCsv(input.rows as Record<string, string>[], delim);
                    writeFileSync(input.file_path, csv, "utf-8");
                    return { success: true, rows_written: input.rows.length, file_path: input.file_path };
                }

                // ── filter ───────────────────────────────────────────────────
                case "filter": {
                    if (!input.column) return { success: false, error: "column is required" };
                    if (input.value === undefined) return { success: false, error: "value is required" };
                    const rows = getRows();
                    const matcher = input.is_regex
                        ? (v: string) => new RegExp(input.value!).test(v)
                        : (v: string) => v === input.value;
                    const matched = rows.filter((r) => matcher(r[input.column!] ?? ""));
                    const limited = input.limit ? matched.slice(0, input.limit) : matched;
                    return { success: true, match_count: matched.length, rows: limited };
                }

                // ── aggregate ────────────────────────────────────────────────
                case "aggregate": {
                    if (!input.column) return { success: false, error: "column is required" };
                    if (!input.operation) return { success: false, error: "operation is required" };
                    const rows = getRows();

                    const compute = (subset: Record<string, string>[]): number => {
                        const nums = subset
                            .map((r) => parseFloat(r[input.column!] ?? ""))
                            .filter((n) => !isNaN(n));
                        if (nums.length === 0) return 0;
                        switch (input.operation) {
                            case "count": return nums.length;
                            case "sum": return nums.reduce((a, b) => a + b, 0);
                            case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
                            case "min": return Math.min(...nums);
                            case "max": return Math.max(...nums);
                            default: return 0;
                        }
                    };

                    if (input.group_by) {
                        const groups: Record<string, Record<string, string>[]> = {};
                        for (const row of rows) {
                            const key = row[input.group_by] ?? "";
                            (groups[key] ??= []).push(row);
                        }
                        const results = Object.entries(groups).map(([key, subset]) => ({
                            [input.group_by!]: key,
                            [input.operation!]: compute(subset),
                        }));
                        return { success: true, operation: input.operation, column: input.column, group_by: input.group_by, results };
                    }

                    return { success: true, operation: input.operation, column: input.column, result: compute(rows) };
                }

                // ── to_json ──────────────────────────────────────────────────
                case "to_json": {
                    if (!input.csv_text) return { success: false, error: "csv_text is required" };
                    const rows = parseCsvText(input.csv_text, delim);
                    return { success: true, json: JSON.stringify(rows, null, 2) };
                }

                // ── from_json ────────────────────────────────────────────────
                case "from_json": {
                    if (!input.rows?.length) return { success: false, error: "rows is required" };
                    return { success: true, csv: rowsToCsv(input.rows as Record<string, string>[], delim) };
                }

                default:
                    return { success: false, error: `Unknown action: ${input.action}` };
            }
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
