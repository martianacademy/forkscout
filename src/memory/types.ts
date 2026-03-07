// src/memory/types.ts — Shared Zod schemas for ForkScout memory
import { z } from 'zod';
export const tripleSchema = z.object({
  id: z.string().optional(),
  subject: z.string(),
  predicate: z.string(), // e.g., "is_a", "has", "lives_in"
  object: z.string(),
  confidence: z.number().min(0).max(100).default(75),
  createdAt: z.string().optional(), // ISO timestamp
});

export type Triple = z.infer<typeof tripleSchema>;

export const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(), // e.g., "person", "organization"
  attributes: z.map(z.string(), z.string()).optional(),
  confidence: z.number().min(0).max(100),
  createdAt: z.string(),
});

export type Entity = z.infer<typeof entitySchema>;

export const exchangeSchema = z.object({
  id: z.string(),
  session: z.string(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string(),
});

export type Exchange = z.infer<typeof exchangeSchema>;
