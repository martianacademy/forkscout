// src/tools/http_request_tools.ts — Make HTTP requests: GET, POST, PUT, DELETE
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false;

export const http_request_tools = tool({
  description: "Make HTTP requests to any URL. Supports GET, POST, PUT, DELETE methods with custom headers and body.",
  inputSchema: z.object({
    url: z.string().describe("The URL to request"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("Request headers as key-value pairs"),
    body: z.string().optional().describe("Request body (for POST, PUT, PATCH)"),
    timeout: z.number().default(30000).describe("Request timeout in milliseconds")
  }),
  execute: async (input) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), input.timeout);

      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers ?? undefined,
        body: input.body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") || "";
      let data;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headersObj[key] = value;
      });

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        body: data
      };
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError") {
        return { success: false, error: `Request timed out after ${input.timeout}ms` };
      }
      return { success: false, error: err.message };
    }
  }
});