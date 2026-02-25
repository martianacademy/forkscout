// src/logs/logger.ts — Module-tagged logger
// All log output is tagged with the calling module name AND written to .forkscout/activity.log.
// Usage:
//   import { log } from "@/logs/logger.ts";
//   const logger = log("telegram");
//   logger.info("Starting long-poll...");   // → [telegram] Starting long-poll...
//   logger.error("Failed", err.message);   // → [telegram] Failed <message>

import { activity } from "@/logs/activity-log.ts";

export interface Logger {
    info: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
}

/**
 * Create a tagged logger for a module.
 * @param module - Short identifier e.g. "telegram", "agent", "mcp", "tools/web_search"
 */
export function log(module: string): Logger {
    return {
        info(msg: string, ...args: unknown[]) {
            console.log(`[${module}] ${msg}`, ...args);
            activity.info(module, args.length ? `${msg} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}` : msg);
        },
        error(msg: string, ...args: unknown[]) {
            console.error(`[${module}] ${msg}`, ...args);
            // Pull full stack from first Error argument if present
            const err = args.find(a => a instanceof Error) as Error | undefined;
            const text = args.length
                ? `${msg} ${args.map(a => a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`
                : msg;
            activity.error(module, text, err);
        },
        warn(msg: string, ...args: unknown[]) {
            console.warn(`[${module}] ${msg}`, ...args);
            activity.warn(module, args.length ? `${msg} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}` : msg);
        },
    };
}
