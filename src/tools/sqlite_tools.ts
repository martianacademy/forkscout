// src/tools/sqlite_tools.ts
//
// Persistent structured storage via SQLite (bun:sqlite — zero extra deps).
//
// Each named database is a separate .sqlite file under .forkscout/db/.
// Databases are auto-created on first use.
//
// Actions:
//   query         — SELECT and any read-only SQL, returns rows as JSON objects
//   exec          — CREATE, INSERT, UPDATE, DELETE; returns affected row count
//   list_tables   — list all tables in a database
//   list_databases — list all .sqlite files in .forkscout/db/
//   delete_database — permanently delete a database file
//
// Use for:
//   - Storing user preferences, task histories, cached data
//   - Structured logs that outlive agent restarts
//   - Any relational data that doesn't fit the knowledge graph

import { tool } from "ai";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

export const IS_BOOTSTRAP_TOOL = false;

const DB_DIR = join(process.cwd(), ".forkscout", "db");

function dbPath(name: string): string {
    // Sanitise: only allow alphanumeric, hyphens, underscores
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(DB_DIR, `${safe}.sqlite`);
}

function openDb(name: string): Database {
    mkdirSync(DB_DIR, { recursive: true });
    return new Database(dbPath(name));
}

export const sqlite_tools = tool({
    description:
        "Persistent structured storage using SQLite. Databases live in .forkscout/db/<name>.sqlite and survive agent restarts. " +
        "Actions: 'query' (SELECT/read SQL → rows), 'exec' (write SQL → affected rows), " +
        "'list_tables' (tables in a db), 'list_databases' (all dbs), 'delete_database' (remove a db file). " +
        "Use for user preferences, task histories, structured logs, cached data — anything relational that the knowledge graph can't handle.",
    inputSchema: z.object({
        action: z
            .enum(["query", "exec", "list_tables", "list_databases", "delete_database"])
            .describe("Operation to perform"),
        database: z
            .string()
            .optional()
            .describe("Database name (no extension). Required for query/exec/list_tables/delete_database."),
        sql: z
            .string()
            .optional()
            .describe("SQL statement to execute. Required for query and exec actions."),
        params: z
            .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .optional()
            .describe("Positional parameters for the SQL statement (use ? placeholders in sql)"),
    }),
    execute: async (input) => {
        try {
            // ── list_databases ──────────────────────────────────────────────
            if (input.action === "list_databases") {
                mkdirSync(DB_DIR, { recursive: true });
                const files = readdirSync(DB_DIR)
                    .filter((f) => f.endsWith(".sqlite"))
                    .map((f) => f.replace(/\.sqlite$/, ""));
                return { success: true, databases: files };
            }

            // ── actions that need a database name ───────────────────────────
            if (!input.database) {
                return { success: false, error: "database is required for this action" };
            }

            // ── delete_database ─────────────────────────────────────────────
            if (input.action === "delete_database") {
                const path = dbPath(input.database);
                if (!existsSync(path)) {
                    return { success: false, error: `Database '${input.database}' does not exist` };
                }
                unlinkSync(path);
                return { success: true, message: `Database '${input.database}' deleted` };
            }

            // ── list_tables ─────────────────────────────────────────────────
            if (input.action === "list_tables") {
                const db = openDb(input.database);
                try {
                    const rows = db
                        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                        .all() as { name: string }[];
                    return { success: true, tables: rows.map((r) => r.name) };
                } finally {
                    db.close();
                }
            }

            // ── query / exec ────────────────────────────────────────────────
            if (!input.sql) {
                return { success: false, error: "sql is required for query and exec actions" };
            }

            const db = openDb(input.database);
            const params = (input.params ?? []) as (string | number | boolean | null)[];

            try {
                if (input.action === "query") {
                    const rows = db.query(input.sql).all(...params);
                    return { success: true, rows, count: rows.length };
                } else {
                    // exec
                    const stmt = db.prepare(input.sql);
                    const info = stmt.run(...params);
                    return {
                        success: true,
                        changes: info.changes,
                        last_insert_row_id: info.lastInsertRowid,
                    };
                }
            } finally {
                db.close();
            }
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
