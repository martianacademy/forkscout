/**
 * File system tools — read, write, append, list, delete files.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { resolveAgentPath } from '../paths';
import { isProtectedPath } from './_helpers';

export const readFile = tool({
    description: 'Read contents of a file.',
    inputSchema: z.object({
        path: z.string().describe('File path to read (relative to project root or absolute)'),
    }),
    execute: async ({ path }) => {
        try {
            const fs = await import('fs/promises');
            const absPath = resolveAgentPath(path);
            return await fs.readFile(absPath, 'utf-8');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return `❌ File not found: "${path}". Use list_directory to check what exists.`;
            if (msg.includes('EISDIR')) return `❌ "${path}" is a directory, not a file. Use list_directory instead.`;
            return `❌ read_file failed for "${path}": ${msg}`;
        }
    },
});

export const writeFile = tool({
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    inputSchema: z.object({
        path: z.string().describe('File path to write to (relative to project root or absolute)'),
        content: z.string().describe('Content to write to the file'),
    }),
    execute: async ({ path, content }) => {
        try {
            const fs = await import('fs/promises');
            const { dirname } = await import('path');
            const absPath = resolveAgentPath(path);
            await fs.mkdir(dirname(absPath), { recursive: true });
            await fs.writeFile(absPath, content, 'utf-8');
            return `File written: ${absPath} (${content.length} bytes)`;
        } catch (err) {
            return `❌ write_file failed for "${path}": ${err instanceof Error ? err.message : String(err)}`;
        }
    },
});

export const appendFile = tool({
    description: 'Append content to an existing file, or create it if it does not exist.',
    inputSchema: z.object({
        path: z.string().describe('File path to append to (relative to project root or absolute)'),
        content: z.string().describe('Content to append'),
    }),
    execute: async ({ path, content }) => {
        try {
            const fs = await import('fs/promises');
            const { dirname } = await import('path');
            const absPath = resolveAgentPath(path);
            await fs.mkdir(dirname(absPath), { recursive: true });
            await fs.appendFile(absPath, content, 'utf-8');
            return `Content appended to: ${absPath}`;
        } catch (err) {
            return `❌ append_file failed for "${path}": ${err instanceof Error ? err.message : String(err)}`;
        }
    },
});

export const listDirectory = tool({
    description: 'List files and directories at a given path. Empty or "." lists the project root.',
    inputSchema: z.object({
        path: z.string().describe('Directory path to list (relative to project root or absolute)'),
    }),
    execute: async ({ path }) => {
        try {
            const fs = await import('fs/promises');
            const absPath = resolveAgentPath(path);
            const entries = await fs.readdir(absPath, { withFileTypes: true });
            return entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return `❌ Directory not found: "${path}". Check the path and try again.`;
            if (msg.includes('ENOTDIR')) return `❌ "${path}" is a file, not a directory.`;
            return `❌ list_directory failed for "${path}": ${msg}`;
        }
    },
});

export const deleteFile = tool({
    description: 'Delete a file or directory. The agent autonomously refuses if the target is critical (memory, source, secrets, git).',
    inputSchema: z.object({
        path: z.string().describe('File or directory path to delete (relative to project root or absolute)'),
    }),
    execute: async ({ path }) => {
        try {
            const absPath = resolveAgentPath(path);
            const refusal = isProtectedPath(absPath);
            if (refusal) return refusal;
            const fs = await import('fs/promises');
            await fs.rm(absPath, { recursive: true });
            return `Deleted: ${absPath}`;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) return `❌ Cannot delete "${path}" — file not found.`;
            return `❌ delete_file failed for "${path}": ${msg}`;
        }
    },
});
