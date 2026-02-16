import { z } from 'zod';
import { resolveAgentPath } from '../paths';

/**
 * Write/Create File Tool
 */
export const writeFileTool = {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    parameters: z.object({
        path: z.string().describe('File path to write to (relative to project root or absolute)'),
        content: z.string().describe('Content to write to the file'),
    }),
    async execute(params: { path: string; content: string }): Promise<string> {
        const fs = await import('fs/promises');
        const { dirname } = await import('path');

        const absPath = resolveAgentPath(params.path);
        // Ensure parent directories exist
        await fs.mkdir(dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, params.content, 'utf-8');
        return `File written: ${absPath} (${params.content.length} bytes)`;
    },
};

/**
 * Append to File Tool
 */
export const appendFileTool = {
    name: 'append_file',
    description: 'Append content to an existing file, or create it if it does not exist.',
    parameters: z.object({
        path: z.string().describe('File path to append to (relative to project root or absolute)'),
        content: z.string().describe('Content to append'),
    }),
    async execute(params: { path: string; content: string }): Promise<string> {
        const fs = await import('fs/promises');
        const { dirname } = await import('path');

        const absPath = resolveAgentPath(params.path);
        await fs.mkdir(dirname(absPath), { recursive: true });
        await fs.appendFile(absPath, params.content, 'utf-8');
        return `Content appended to: ${absPath}`;
    },
};

/**
 * List Directory Tool
 */
export const listDirTool = {
    name: 'list_directory',
    description: 'List files and directories at a given path. Empty or "." lists the project root.',
    parameters: z.object({
        path: z.string().describe('Directory path to list (relative to project root or absolute)'),
    }),
    async execute(params: { path: string }): Promise<string[]> {
        const fs = await import('fs/promises');
        const absPath = resolveAgentPath(params.path);
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        return entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
    },
};

/**
 * Delete File Tool
 */
export const deleteFileTool = {
    name: 'delete_file',
    description: 'Delete a file or empty directory.',
    parameters: z.object({
        path: z.string().describe('File or directory path to delete (relative to project root or absolute)'),
    }),
    async execute(params: { path: string }): Promise<string> {
        const fs = await import('fs/promises');
        const absPath = resolveAgentPath(params.path);
        await fs.rm(absPath, { recursive: true });
        return `Deleted: ${absPath}`;
    },
};

export const filesystemTools = [
    writeFileTool,
    appendFileTool,
    listDirTool,
    deleteFileTool,
];
