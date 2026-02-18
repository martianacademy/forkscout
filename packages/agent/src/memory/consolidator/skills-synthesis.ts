/**
 * Skill synthesis — extract reusable skills from repeated exchange patterns.
 *
 * Scans unconsolidated vector store chunks for recurring tool-usage patterns
 * and creates skill entries when a pattern appears >= 3 times.
 *
 * @module memory/consolidator/skills-synthesis
 */

import type { SkillStore } from '../skills';
import type { VectorStore } from '../vector-store';

/**
 * Synthesize skills from repeated exchange patterns in the vector store.
 * Groups chunks by keyword patterns and creates skill entries for patterns
 * that appear >= 3 times. Returns the number of new skills created.
 */
export function synthesizeSkills(vectorStore: VectorStore, skills: SkillStore): number {
    const chunks = vectorStore.getUnconsolidated();
    if (chunks.length < 5) return 0;

    const patternGroups = new Map<string, string[]>();

    for (const chunk of chunks) {
        const text = chunk.text.toLowerCase();
        const keywords: string[] = [];

        if (text.includes('search') || text.includes('web_search')) keywords.push('web-search');
        if (text.includes('run_command') || text.includes('execute')) keywords.push('command');
        if (text.includes('file') && (text.includes('read') || text.includes('write'))) keywords.push('file-ops');
        if (text.includes('knowledge') || text.includes('memory')) keywords.push('memory');
        if (text.includes('telegram') || text.includes('send_message')) keywords.push('telegram');

        if (keywords.length > 0) {
            const key = keywords.sort().join('+');
            const list = patternGroups.get(key) || [];
            list.push(chunk.text.slice(0, 300));
            patternGroups.set(key, list);
        }

        // Mark as consolidated
        chunk.consolidated = true;
    }

    let synthesized = 0;
    for (const [pattern, instances] of patternGroups) {
        if (instances.length >= 3 && !skills.hasSkill(pattern)) {
            const examples = instances.slice(0, 3).map((e, i) => `Example ${i + 1}: ${e.slice(0, 150)}`).join('\n');
            skills.addSkill({
                id: pattern,
                name: pattern.replace(/\+/g, ' + '),
                intent: `User wants to perform: ${pattern.replace(/\+/g, ', ')}`,
                steps: [`Pattern detected from ${instances.length} similar exchanges`, examples],
                successRate: Math.min(0.5 + instances.length * 0.1, 0.95),
                lastUsed: Date.now(),
                evidenceCount: instances.length,
                derivedFrom: [],
            });
            synthesized++;
        }
    }

    return synthesized;
}
