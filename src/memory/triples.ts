// src/memory/triples.ts — Triple store with inference engine for ForkScout
import { z } from 'zod';
import { tripleSchema, type Triple } from './types';

// In-memory storage (in production, replace with SQLite or Redis)
const triples: Array<Triple> = [];

export function addTriple(triple: Triple): void {
  const parsed = tripleSchema.safeParse(triple);
  if (!parsed.success) {
    throw new Error(`Invalid triple: ${JSON.stringify(triple)}`);
  }

  triples.push({
    ...parsed.data,
    createdAt: parsed.data.createdAt || new Date().toISOString(),
  });
}

export function getTriplesBySubject(subject: string): Array<Triple> {
  return triples.filter(t => t.subject === subject);
}

export function getObjects(subject: string, predicate: string): Array<string> {
  return triples
    .filter(t => t.subject === subject && t.predicate === predicate)
    .map(t => t.object);
}

export function getSubjects(predicate: string, object: string): Array<string> {
  return triples
    .filter(t => t.predicate === predicate && t.object === object)
    .map(t => t.subject);
}

/** Inference: transitive `has` relations (e.g., Suru → brain → neurons) */
export function getTransitiveObjects(subject: string, predicate: string): Array<string> {
  const direct = getObjects(subject, predicate);
  let all: Array<string> = [...direct];

  for (const obj of direct) {
    const nested = getObjects(obj, predicate);
    if (nested.length > 0) {
      all = [...all, ...getTransitiveObjects(obj, predicate)];
    }
  }

  return all;
}

/** Initialize with Suru—human—brain—neurons triples */
export function initializeSampleTriples(): void {
  addTriple({ subject: 'Suru', predicate: 'is_a', object: 'human', confidence: 100 });
  addTriple({ subject: 'human', predicate: 'has', object: 'brain', confidence: 100 });
  addTriple({ subject: 'brain', predicate: 'has', object: 'neurons', confidence: 100 });
}

/** Export triples for debugging/testing */
export function exportTriples(): Array<Triple> {
  return triples;
}

/** Clear all triples (for testing) */
export function clearTriples(): void {
  triples.length = 0;
}
