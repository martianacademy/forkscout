// src/memory/__tests__/triples.test.ts — Test triple store with Suru example

declare const test: any;
import { addTriple, getTriplesBySubject, getObjects, initializeSampleTriples, clearTriples } from '../triples';

// Run with: bun test src/memory/__tests__/triples.test.ts
test('should store and retrieve triples correctly', () => {
  clearTriples();
  addTriple({ subject: 'Suru', predicate: 'is_a', object: 'human', confidence: 100 });
  addTriple({ subject: 'human', predicate: 'has', object: 'brain', confidence: 100 });
  addTriple({ subject: 'brain', predicate: 'has', object: 'neurons', confidence: 100 });

  const result = getObjects('Suru', 'is_a');
  if (result[0] !== 'human') {
    throw new Error('Expected human');
  }
});
