// src/tools/memory_tools.ts — Local memory tools for the agent.
// Provides the same interface the agent used via MCP, now built-in with zero dependencies.
// Registered only when config.memory.enabled is true.

import { tool } from "ai";
import { z } from "zod";
import * as store from "@/memory/store.ts";

export const memory__context = tool({
    description:
        "Manage per-session working memory. " +
        "action='get' returns the session's context entries. " +
        "action='push' appends a new entry (requires content and event_type).",
    inputSchema: z.object({
        action: z.enum(["get", "push"]),
        session_id: z.string().describe("Session identifier"),
        content: z.string().optional().describe("Content to push (required for action=push)"),
        event_type: z.string().optional().default("action").describe("Type: action, observation, thought"),
    }),
    execute: async (input) => {
        if (input.action === "get") {
            const entries = store.getContext(input.session_id);
            if (entries.length === 0) return { success: true, entries: [] as store.ContextEntry[], message: "No context for this session yet." };
            return { success: true, entries };
        }
        if (!input.content) return { success: false, error: "content is required for action=push" };
        store.pushContext(input.session_id, input.content, input.event_type ?? "action");
        return { success: true, message: "Context entry saved." };
    },
});

export const memory__recall = tool({
    description:
        "Search across all stored memory (observations, entities, session context) using keyword matching. " +
        "Returns the most relevant results sorted by relevance and recency.",
    inputSchema: z.object({
        query: z.string().describe("Search query — keywords describing what you're looking for"),
        max_results: z.number().optional().default(10),
    }),
    execute: async (input) => {
        const results = store.recall(input.query, input.max_results);
        if (results.length === 0) return { success: true, results: [] as store.RecallResult[], message: "No matching memories found." };
        return { success: true, results };
    },
});

export const memory__observe = tool({
    description:
        "Record a user-assistant exchange pair. Use after completing a task to save what the user asked " +
        "and what you did (including root cause and solution if applicable).",
    inputSchema: z.object({
        user: z.string().describe("What the user asked or wanted"),
        assistant: z.string().describe("What you did — include root cause and solution"),
    }),
    execute: async (input) => {
        store.observe(input.user, input.assistant);
        return { success: true, message: "Observation saved." };
    },
});

export const memory__remember = tool({
    description:
        "Save a named entity or fact to long-term memory. Use for important facts, preferences, " +
        "project details, or anything future sessions would benefit from knowing. " +
        "If an entity with the same name exists, it will be updated.",
    inputSchema: z.object({
        name: z.string().describe("Entity name — e.g., 'project-stack', 'user-preference-timezone'"),
        type: z.string().describe("Entity type — e.g., 'fact', 'preference', 'project', 'person'"),
        content: z.string().describe("The fact or information to remember"),
    }),
    execute: async (input) => {
        store.remember(input.name, input.type, input.content);
        return { success: true, message: `Entity '${input.name}' saved.` };
    },
});

/** All memory tools as a flat record — merge into the tools map when enabled. */
export const memoryTools: Record<string, any> = {
    memory__context,
    memory__recall,
    memory__observe,
    memory__remember,
};
