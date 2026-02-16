import { z } from 'zod';
import { resolveAgentPath } from '../paths';
import fs from 'fs/promises';

/**
 * Generate Presentation Tool
 * --------------------------
 * Creates a presentation in Marp Markdown format. 
 * Marp MD can be opened in VS Code with Marp extension, or converted to PPTX/PDF via:
 * - Online: marp.app
 * - CLI: npx @marp-team/marp-cli presentation.md --pptx
 * 
 * Example usage:
 * generate_presentation({
 *   title: "My Slides",
 *   slides: [
 *     { title: "Slide 1", content: "Bullet 1\\nBullet 2" },
 *     { title: "Slide 2", content: "More content" }
 *   ],
 *   outputPath: "my-presentation.md"
 * })
 */
export const generatePresentationTool = {
  name: 'generate_presentation',
  description: 'Generate a presentation in Marp Markdown format (easily convertible to PPTX/PDF via Marp tools). Specify title, array of slides (each with title/content), and output file path.',
  parameters: z.object({
    title: z.string().describe('Presentation title'),
    slides: z.array(
      z.object({
        title: z.string().describe('Slide title'),
        content: z.string().describe('Slide content (use \\n for new lines, **bold**, etc.)'),
      })
    ).describe('Array of slides'),
    outputPath: z.string().describe('Output Markdown file path (relative to project root)'),
  }),
  async execute(params: { title: string; slides: Array<{title: string; content: string}>; outputPath: string }): Promise<string> {
    let md = `---
marp: true
theme: default
paginate: true
---
# ${params.title}

---

`;
    for (const slide of params.slides) {
      md += `# ${slide.title}

${slide.content.replace(/\n/g, '\n\n')}

---
`;
    }

    const absPath = resolveAgentPath(params.outputPath);
    await fs.writeFile(absPath, md, 'utf-8');
    return `✅ Presentation generated: ${params.outputPath}\n\nOpen in Marp (marp.app) or convert: npx @marp-team/marp-cli "${params.outputPath}" --pptx -o output.pptx`;
  },
};
