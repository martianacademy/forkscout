// src/tools/regex_tools.ts
//
// Regex testing, extraction, replacement, and analysis — zero deps, pure JS.
//
// Actions:
//   test         — does pattern match the input? returns true/false + first match
//   match_all    — find all matches (with capture groups) in the input
//   replace      — replace matches with a substitution string ($1, $2 backrefs work)
//   split        — split text by pattern
//   named_groups — extract named capture groups (?<name>...) from all matches
//   explain      — break down a regex pattern into a human-readable description
//
// Flags: g (global), i (case-insensitive), m (multiline), s (dot-all)
// Use this instead of piping to grep/sed/awk in run_shell_command_tools.

import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false;

const FLAG_SCHEMA = z
    .string()
    .max(8)
    .default("")
    .describe("Regex flags: any combination of g (global), i (case-insensitive), m (multiline), s (dot-all)");

function buildRegex(pattern: string, flags: string): RegExp {
    // Always add 'd' flag if available (Bun/Node 18+) for indices, safe fallback
    try {
        return new RegExp(pattern, flags);
    } catch (err: any) {
        throw new Error(`Invalid regex: ${err.message}`);
    }
}

// Very lightweight human-readable explainer (covers the most common tokens)
const TOKENS: Array<[RegExp, string | ((m: string) => string)]> = [
    [/^\^/, "start of string"],
    [/^\$/, "end of string"],
    [/^\\./, (m: string) => ({
        "\\d": "digit [0-9]", "\\D": "non-digit", "\\w": "word char [a-zA-Z0-9_]",
        "\\W": "non-word char", "\\s": "whitespace", "\\S": "non-whitespace",
        "\\b": "word boundary", "\\B": "non-word boundary", "\\n": "newline",
        "\\t": "tab", "\\r": "carriage return",
    })[m] ?? `escaped '${m[1]}'`],
    [/^\[.*?\]/, "character class"],
    [/^\(.*/, "group"],
    [/^\{[0-9,]+\}/, "quantifier"],
    [/^\*/, "zero or more (greedy)"],
    [/^\+/, "one or more (greedy)"],
    [/^\?/, "zero or one (optional)"],
    [/^\./, "any character except newline"],
    [/^\|/, "or"],
];

function explainPattern(pattern: string): string {
    const parts: string[] = [];
    let i = 0;
    while (i < pattern.length) {
        let matched = false;
        for (const [re, desc] of TOKENS) {
            const m = pattern.slice(i).match(re);
            if (m) {
                parts.push(typeof desc === "function" ? (desc as (m: string) => string)(m[0]) : desc);
                i += m[0].length;
                matched = true;
                break;
            }
        }
        if (!matched) { parts.push(`literal '${pattern[i]}'`); i++; }
    }
    return parts.join(", ");
}

export const regex_tools = tool({
    description:
        "Regex testing, extraction, replacement, and analysis — zero deps. " +
        "Actions: 'test' (boolean match check), 'match_all' (all matches + capture groups), " +
        "'replace' (substitute matches; $1/$2 backrefs supported), 'split' (split by pattern), " +
        "'named_groups' (extract (?<name>...) named captures from all matches), " +
        "'explain' (human-readable description of what a pattern does). " +
        "Use this instead of grep/sed in shell commands.",
    inputSchema: z.object({
        action: z
            .enum(["test", "match_all", "replace", "split", "named_groups", "explain"])
            .describe("Operation to perform"),
        pattern: z.string().describe("Regex pattern (without surrounding slashes)"),
        flags: FLAG_SCHEMA,
        text: z.string().optional().describe("Input text to operate on (required for all except explain)"),
        replacement: z
            .string()
            .optional()
            .describe("Replacement string for 'replace' action. Use $1, $2 for backreferences."),
        limit: z
            .number()
            .int()
            .min(1)
            .max(1000)
            .optional()
            .describe("Max matches to return for match_all / named_groups"),
    }),
    execute: async (input) => {
        try {
            switch (input.action) {
                // ── test ─────────────────────────────────────────────────────
                case "test": {
                    if (input.text === undefined) return { success: false, error: "text is required" };
                    const re = buildRegex(input.pattern, input.flags.replace("g", ""));
                    const m = re.exec(input.text);
                    return {
                        success: true,
                        matched: m !== null,
                        first_match: m?.[0] ?? null,
                        index: m?.index ?? null,
                        groups: m?.groups ?? null,
                    };
                }

                // ── match_all ─────────────────────────────────────────────────
                case "match_all": {
                    if (input.text === undefined) return { success: false, error: "text is required" };
                    // Force global flag
                    const flags = input.flags.includes("g") ? input.flags : input.flags + "g";
                    const re = buildRegex(input.pattern, flags);
                    const matches: Array<{ match: string; index: number; groups: string[] }> = [];
                    let m: RegExpExecArray | null;
                    const limit = input.limit ?? 200;
                    while ((m = re.exec(input.text)) !== null && matches.length < limit) {
                        matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
                        if (!flags.includes("g")) break;
                    }
                    return { success: true, count: matches.length, matches };
                }

                // ── replace ───────────────────────────────────────────────────
                case "replace": {
                    if (input.text === undefined) return { success: false, error: "text is required" };
                    if (input.replacement === undefined) return { success: false, error: "replacement is required" };
                    const re = buildRegex(input.pattern, input.flags);
                    const result = input.text.replace(re, input.replacement);
                    return { success: true, result, changed: result !== input.text };
                }

                // ── split ─────────────────────────────────────────────────────
                case "split": {
                    if (input.text === undefined) return { success: false, error: "text is required" };
                    const re = buildRegex(input.pattern, input.flags);
                    const parts = input.text.split(re);
                    const limited = input.limit ? parts.slice(0, input.limit) : parts;
                    return { success: true, count: parts.length, parts: limited };
                }

                // ── named_groups ──────────────────────────────────────────────
                case "named_groups": {
                    if (input.text === undefined) return { success: false, error: "text is required" };
                    const flags = input.flags.includes("g") ? input.flags : input.flags + "g";
                    const re = buildRegex(input.pattern, flags);
                    const results: Record<string, string>[] = [];
                    let m: RegExpExecArray | null;
                    const limit = input.limit ?? 200;
                    while ((m = re.exec(input.text)) !== null && results.length < limit) {
                        if (m.groups) results.push({ ...m.groups });
                    }
                    return { success: true, count: results.length, matches: results };
                }

                // ── explain ───────────────────────────────────────────────────
                case "explain": {
                    // Validate pattern first
                    buildRegex(input.pattern, "");
                    const explanation = explainPattern(input.pattern);
                    return {
                        success: true,
                        pattern: input.pattern,
                        flags: input.flags || "(none)",
                        explanation,
                    };
                }

                default:
                    return { success: false, error: `Unknown action: ${input.action}` };
            }
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
