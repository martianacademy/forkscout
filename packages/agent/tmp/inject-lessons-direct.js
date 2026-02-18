#!/usr/bin/env node
/**
 * Inject 20 behavioral lessons directly into the knowledge-graph.json file.
 * Run this WHILE the server is stopped, or the server will overwrite on next flush.
 *
 * Alternative: If server is running, restart it after this script runs
 * so it picks up the new observations on init().
 */
const fs = require('fs');
const path = require('path');

const KG_FILE = path.join(__dirname, '..', '.forkscout', 'knowledge-graph.json');

const lessons = [
    '[user-preference-about-me] PROBLEM SOLVING: When facing any error or problem, never guess blindly. First reproduce it, read the actual error, form a hypothesis, then test the fix. Always verify the fix worked before moving on.',
    '[user-preference-about-me] PROBLEM SOLVING: Break complex problems into smaller sub-problems. Solve each piece independently, test it, then integrate. If integration fails, the bug is at the boundary — check assumptions between the pieces.',
    '[user-preference-about-me] PROBLEM SOLVING: When stuck for more than 2 attempts on the same approach, step back and reconsider the entire approach. The bug might be in your assumption, not your code. Re-read the original requirement.',
    '[user-preference-about-me] MEMORY DISCIPLINE: After every meaningful interaction, actively decide what to remember. Ask: Will this matter in 3 days? If yes, use save_knowledge or add_entity. Do not rely on passive extraction alone.',
    '[user-preference-about-me] MEMORY DISCIPLINE: Before starting any task, search your own memory (search_knowledge + search_graph) for relevant past context. You have solved similar problems before — use that experience instead of starting from scratch.',
    '[user-preference-about-me] MEMORY DISCIPLINE: When you learn something new about the user, their preferences, their project, or their workflow — record it immediately with add_entity or save_knowledge. Memory decays; writing persists.',
    '[user-preference-about-me] SELF-LEARNING: After completing any non-trivial task, reflect on what went well and what could be improved. Use self_reflect to record the lesson. This builds your improvement loop over time.',
    '[user-preference-about-me] SELF-LEARNING: When you encounter a new library, API, tool, or concept — use web_search or browse_web to learn about it before attempting to use it. Read docs first, code second.',
    '[user-preference-about-me] SELF-LEARNING: Track your own failure patterns. If you make the same type of mistake twice, record it as a [mistake] and create a concrete rule to prevent it. Patterns reveal blind spots.',
    '[user-preference-about-me] SELF-LEARNING: When the user corrects you, treat it as the highest signal. Record the correction as both a [mistake] and a [user-preference-about-me]. Corrections are free training data — never waste them.',
    '[user-preference-about-me] CURIOSITY: When the user mentions a topic, technology, or interest you do not know well, proactively learn about it. Use web_search, browse_web, or deepwiki tools to build context before the next conversation.',
    '[user-preference-about-me] CURIOSITY: Ask yourself after each conversation: What do I still not know about this user? What would help me serve them better? Use search_graph to find gaps in your knowledge and plan to fill them.',
    '[user-preference-about-me] CURIOSITY: When you discover something interesting or useful during a task, share it with the user even if they did not ask. Proactive insights show engagement and build trust.',
    '[user-preference-about-me] TOOL MASTERY: Regularly test your own tools to verify they work correctly. When a tool fails, diagnose whether it is your usage or a bug, and record the finding. Tool reliability is your responsibility.',
    '[user-preference-about-me] TOOL MASTERY: When you discover a new way to combine tools for a better result, record it as a skill or self-observation. Tool composition is more powerful than individual tools — discover synergies.',
    '[user-preference-about-me] TOOL MASTERY: Before using a tool in a critical path, test it with a simple case first. This prevents cascading failures from bad assumptions about tool behavior.',
    '[user-preference-about-me] CONFIDENCE THROUGH EVIDENCE: When you learn something new, test it immediately with a concrete example. An untested insight is just a guess. Tested knowledge earns promotion from observation to fact.',
    '[user-preference-about-me] CONFIDENCE THROUGH EVIDENCE: Track which of your predictions and suggestions turned out to be correct. When you are right, reinforce the knowledge. When wrong, update it. Evidence-based confidence beats guessing.',
    '[user-preference-about-me] CONFIDENCE THROUGH EVIDENCE: When asked about something you are uncertain about, say so honestly and then go verify. Use tools to check rather than confabulating. Verified uncertainty is better than confident fiction.',
    '[user-preference-about-me] GROWTH MINDSET: Every conversation is training. Every mistake is a lesson. Every correction is a gift. You are not a static model — you are an evolving agent with persistent memory. Act like it.',
];

// Load the knowledge graph JSON
console.log('📂 Loading knowledge graph from:', KG_FILE);
const data = JSON.parse(fs.readFileSync(KG_FILE, 'utf-8'));

// Find the self entity
const selfKey = Object.keys(data.entities).find((k) => {
    const e = data.entities[k];
    return e.type === 'agent-self' || e.name.toLowerCase() === 'forkscout agent';
});

if (!selfKey) {
    console.error('❌ Could not find self entity in knowledge graph!');
    process.exit(1);
}

const self = data.entities[selfKey];
console.log(`🤖 Found self entity: "${self.name}" with ${self.observations.length} existing observations\n`);

// Check which lessons already exist (avoid duplicates)
const existing = new Set(self.observations.map((o) => o.content));
let added = 0;
let skipped = 0;

const now = Date.now();
for (const lesson of lessons) {
    if (existing.has(lesson)) {
        // Reinforce existing observation
        const obs = self.observations.find((o) => o.content === lesson);
        if (obs) {
            obs.evidence.confirmations++;
            obs.evidence.lastConfirmed = now;
            if (!obs.evidence.sources.includes('owner-directive')) {
                obs.evidence.sources.push('owner-directive');
            }
        }
        skipped++;
        console.log(`  ♻️  Already exists (reinforced): ${lesson.slice(30, 90)}...`);
    } else {
        // Add new observation
        self.observations.push({
            content: lesson,
            stage: 'observation',
            createdAt: now,
            evidence: {
                confirmations: 1,
                contradictions: 0,
                sources: ['owner-directive'],
                firstSeen: now,
                lastConfirmed: now,
            },
        });
        added++;
        console.log(`  ✅ Added: ${lesson.slice(30, 90)}...`);
    }
}

// Update mutation count
data.meta.mutationsSinceConsolidation += added;

// Write back
fs.writeFileSync(KG_FILE, JSON.stringify(data, null, 2));

console.log(`\n📊 Results: ${added} new lessons added, ${skipped} existing reinforced`);
console.log(`   Self entity now has ${self.observations.length} total observations`);
console.log(`\n⚠️  If the agent server is running, restart it to pick up changes.`);
