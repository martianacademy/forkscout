/**
 * Extraction prompt builder — produces the LLM prompt for entity/relation extraction.
 *
 * Called by `MemoryManager` after each assistant turn to extract structured
 * knowledge from the conversation into the knowledge graph.
 *
 * @module knowledge-graph/extraction
 */

import { RELATION_TYPES } from './types';

/**
 * Build a prompt that asks the LLM to extract entities and relations from a
 * single conversation exchange.
 *
 * The returned prompt instructs the model to respond with JSON matching the
 * `ExtractedEntities` schema, using only the canonical `RELATION_TYPES`.
 *
 * @param userMessage      - The user's message text
 * @param assistantMessage - The assistant's reply (truncated to 2 000 chars internally)
 * @returns A ready-to-send prompt string
 *
 * @example
 * ```ts
 * const prompt = buildExtractionPrompt(
 *   'I switched from React to Svelte for the dashboard',
 *   'Nice! Svelte is great for dashboards...'
 * );
 * const json = await llm.generate(prompt);
 * ```
 */
export function buildExtractionPrompt(userMessage: string, assistantMessage: string): string {
    return `Extract structured knowledge from this conversation exchange. 
Identify entities (people, projects, technologies, preferences, services) and relations between them.

CONVERSATION:
User: ${userMessage}
Assistant: ${assistantMessage.slice(0, 2000)}

Respond ONLY with valid JSON matching this schema:
{
  "entities": [
    { "name": "EntityName", "type": "person|project|technology|preference|concept|file|service|organization|other", "observations": ["fact about this entity"] }
  ],
  "relations": [
    { "from": "EntityA", "to": "EntityB", "type": "RELATION_TYPE" }
  ]
}

ALLOWED RELATION TYPES (use ONLY these):
  ${RELATION_TYPES.join(', ')}

Rules:
- Only extract concrete, factual information — no speculation
- Entity names should be proper nouns or specific terms (e.g. "React", "TypeScript", not "a framework")
- Observations should be self-contained facts (e.g. "User prefers TypeScript over JavaScript")
- Relations MUST use one of the allowed types listed above
- Skip trivial or generic exchanges (e.g. "hello", "thanks")
- If nothing meaningful to extract, return {"entities": [], "relations": []}
- Keep it concise — 2-5 entities max per exchange`;
}
