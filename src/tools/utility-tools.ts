/**
 * Utility tools — presentation generation.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { resolveAgentPath } from '../paths';
import { withAccess } from './access';

export const generatePresentation = withAccess('guest', tool({
    description: 'Generate a presentation in Marp Markdown format (easily convertible to PPTX/PDF). Specify title, array of slides (each with title/content), and output file path.',
    inputSchema: z.object({
        title: z.string().describe('Presentation title'),
        slides: z.array(z.object({
            title: z.string().describe('Slide title'),
            content: z.string().describe('Slide content (use \\n for new lines, **bold**, etc.)'),
        })).describe('Array of slides'),
        outputPath: z.string().describe('Output Markdown file path (relative to project root)'),
    }),
    execute: async ({ title, slides, outputPath }) => {
        try {
            const fs = await import('fs/promises');
            const { dirname } = await import('path');
            let md = `---\nmarp: true\ntheme: default\npaginate: true\n---\n# ${title}\n\n---\n\n`;
            for (const slide of slides) {
                md += `# ${slide.title}\n\n${slide.content.replace(/\n/g, '\n\n')}\n\n---\n\n`;
            }
            const absPath = resolveAgentPath(outputPath);
            await fs.mkdir(dirname(absPath), { recursive: true });
            await fs.writeFile(absPath, md, 'utf-8');
            return `Presentation saved to ${absPath} (${slides.length} slides). Open in VS Code with Marp extension or convert with: npx @marp-team/marp-cli ${outputPath} --pptx`;
        } catch (err) {
            return `\u274c generatePresentation failed: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
}));
