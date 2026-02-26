// src/tools/json_tools.ts — JSON operations: validate, format, query, minify
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false;

export const json_tools = tool({
  description: "JSON operations: validate, format (pretty print), minify, query with JSONPath, merge, diff.",
  inputSchema: z.object({
    operation: z.enum(["validate", "format", "minify", "query", "merge", "diff"]).describe("JSON operation to perform"),
    data: z.string().describe("JSON string to operate on"),
    query: z.string().optional().describe("JSONPath query (for query operation)"),
    data2: z.string().optional().describe("Second JSON string (for merge/diff operations)"),
    indent: z.number().default(2).describe("Indent spaces for format operation")
  }),
  execute: async (input) => {
    try {
      const json = JSON.parse(input.data);
      
      switch (input.operation) {
        case "validate": {
          return { success: true, valid: true, parsed: json };
        }
        
        case "format": {
          return {
            success: true,
            formatted: JSON.stringify(json, null, input.indent)
          };
        }
        
        case "minify": {
          return {
            success: true,
            minified: JSON.stringify(json)
          };
        }
        
        case "query": {
          if (!input.query) {
            return { success: false, error: "JSONPath query required" };
          }
          // Simple JSONPath implementation (supports basic queries)
          const result = simpleJsonPath(json, input.query);
          return {
            success: true,
            query: input.query,
            result
          };
        }
        
        case "merge": {
          if (!input.data2) {
            return { success: false, error: "Second JSON required for merge" };
          }
          const json2 = JSON.parse(input.data2);
          const merged = { ...json, ...json2 };
          return {
            success: true,
            merged,
            mergedString: JSON.stringify(merged, null, 2)
          };
        }
        
        case "diff": {
          if (!input.data2) {
            return { success: false, error: "Second JSON required for diff" };
          }
          const json2 = JSON.parse(input.data2);
          const diff = findDiff(json, json2);
          return {
            success: true,
            diff
          };
        }
        
        default:
          return { success: false, error: "Unknown operation" };
      }
    } catch (error) {
      return { success: false, error: `JSON Error: ${String(error)}` };
    }
  }
});

// Simple JSONPath-like query (supports: $.key, $.key.subkey, $[0], $.key[0])
function simpleJsonPath(obj: any, path: string): any {
  const cleanPath = path.replace(/^\$\.?/, "");
  if (!cleanPath) return obj;
  
  const parts = cleanPath.split(/\.|\[|\]/).filter(Boolean);
  let current = obj;
  
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      current = isNaN(idx) ? undefined : current[idx];
    } else {
      current = current[part];
    }
  }
  
  return current;
}

function findDiff(obj1: any, obj2: any, path = ""): any {
  const diff: any = {};
  
  const keys1 = obj1 ? Object.keys(obj1) : [];
  const keys2 = obj2 ? Object.keys(obj2) : [];
  const allKeys = Array.from(new Set([...keys1, ...keys2]));
  
  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const val1 = obj1?.[key];
    const val2 = obj2?.[key];
    
    if (JSON.stringify(val1) !== JSON.stringify(val2)) {
      if (typeof val1 === "object" && typeof val2 === "object" && val1 !== null && val2 !== null) {
        diff[key] = findDiff(val1, val2, currentPath);
      } else {
        diff[key] = { old: val1, new: val2 };
      }
    }
  }
  
  return diff;
}