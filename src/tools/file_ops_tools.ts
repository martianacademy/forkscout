// src/tools/file_ops_tools.ts — File operations: copy, move, delete, exists, size
import { tool } from "ai";
import { z } from "zod";
import { readdir, stat, mkdir, rm, copyFile, rename } from "fs/promises";
import { existsSync } from "fs";

export const IS_BOOTSTRAP_TOOL = false;

export const file_ops_tools = tool({
  description: "File operations: check if file exists, get file size, copy, move, delete files and directories.",
  inputSchema: z.object({
    operation: z.enum(["exists", "size", "copy", "move", "delete", "mkdir", "list"]).describe("Operation to perform"),
    path: z.string().describe("File or directory path"),
    dest: z.string().optional().describe("Destination path (for copy/move)"),
    recursive: z.boolean().default(false).describe("For delete/mkdir: recursive delete or create parent dirs")
  }),
  execute: async (input) => {
    try {
      switch (input.operation) {
        case "exists": {
          const exists = existsSync(input.path);
          return { success: true, path: input.path, exists };
        }
        
        case "size": {
          const stats = await stat(input.path);
          return {
            success: true,
            path: input.path,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile()
          };
        }
        
        case "copy": {
          if (!input.dest) return { success: false, error: "Destination path required for copy" };
          await copyFile(input.path, input.dest);
          return { success: true, from: input.path, to: input.dest };
        }
        
        case "move": {
          if (!input.dest) return { success: false, error: "Destination path required for move" };
          await rename(input.path, input.dest);
          return { success: true, from: input.path, to: input.dest };
        }
        
        case "delete": {
          const stats = await stat(input.path);
          if (stats.isDirectory()) {
            await rm(input.path, { recursive: input.recursive });
          } else {
            await rm(input.path);
          }
          return { success: true, deleted: input.path };
        }
        
        case "mkdir": {
          await mkdir(input.path, { recursive: input.recursive });
          return { success: true, created: input.path };
        }
        
        case "list": {
          const stats = await stat(input.path);
          if (!stats.isDirectory()) {
            return { success: false, error: "Path is not a directory" };
          }
          const entries = await readdir(input.path, { withFileTypes: true });
          return {
            success: true,
            path: input.path,
            entries: entries.map(e => ({
              name: e.name,
              isDirectory: e.isDirectory(),
              isFile: e.isFile()
            }))
          };
        }
        
        default:
          return { success: false, error: "Unknown operation" };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}