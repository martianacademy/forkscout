// src/tools/http_request_tools.ts — Make HTTP requests: GET, POST, PUT, DELETE
import { tool } from "ai";
import { z } from "zod";


const SIZE_THRESHOLD = 10 * 1024; // 10KB - trigger save + summarize for responses larger than this

export const http_request_tools = tool({
  description:
    "Make HTTP requests (GET, POST, PUT, PATCH, DELETE) to any URL with custom headers and body. " +
    "WHEN TO USE: calling external APIs (REST, webhooks, health checks); sending data to a service; " +
    "checking if a URL is reachable. " +
    "WHEN NOT TO USE: browsing or scraping web pages with JavaScript — use web_browser_tools (full Playwright); " +
    "simple web content fetching without interactivity — try this first, fall back to web_browser_tools if JS required. " +
    "Large responses (>10KB) are automatically saved to /tmp/forkscout-http/ and the path is returned — use read_file_tools to read them. " +
    "Set headers as a plain object: {'Content-Type': 'application/json', 'Authorization': 'Bearer {{secret:api_token}}'}. " +
    "Example: {url: 'https://api.example.com/users', method: 'POST', body: JSON.stringify({name: 'Alice'}), headers: {'Content-Type': 'application/json'}}",
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

      // Get response as text first to check size
      const contentType = response.headers.get("content-type") || "";
      let bodyText: string;

      if (contentType.includes("application/json")) {
        const jsonData = await response.json();
        bodyText = JSON.stringify(jsonData);
      } else {
        bodyText = await response.text();
      }

      // Check if response is large and needs to be saved
      let isLargeResponse = false;
      let tempFilePath = "";

      if (bodyText.length > SIZE_THRESHOLD) {
        isLargeResponse = true;
        const tempDir = "/tmp/forkscout-http";
        // Ensure directory exists
        const { mkdirSync, existsSync } = await import("fs");
        if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
        tempFilePath = `${tempDir}/http-response-${Date.now()}.txt`;
        await Bun.write(tempFilePath, bodyText);
      }

      // Parse body for return
      let bodyData: unknown;
      try {
        bodyData = JSON.parse(bodyText);
      } catch {
        bodyData = bodyText;
      }

      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headersObj[key] = value;
      });

      const result: Record<string, unknown> = {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        body: isLargeResponse ? `[saved to ${tempFilePath}]` : bodyData,
      };

      // If large response, add info about saved file
      if (isLargeResponse) {
        result.isLargeResponse = true;
        result.tempFilePath = tempFilePath;
        result.message = `Response body too large (${bodyText.length} chars). Saved to ${tempFilePath}. Use read_file_tools to read it.`;
      }

      // Surface HTTP errors clearly so the agent doesn't treat 4xx/5xx as success
      if (!response.ok) {
        result.error = `HTTP ${response.status} ${response.statusText}`;
      }

      return result;
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError") {
        return { success: false, error: `Request timed out after ${input.timeout}ms` };
      }
      return { success: false, error: err.message };
    }
  }
});
