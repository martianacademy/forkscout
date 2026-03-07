# src/memory — Knowledge Graph & Exchange Storage

ForkScout memory stores two types of persistent facts:
1. **Entities** (e.g., `Suru — is_a → human`)
2. **Exchanges** (user-assistant conversation turns)

## 🧠 Knowledge Graph
- Triplet format: `{ subject, predicate, object }`
- Auto-inference via transitive relations (e.g., `Suru — has → neurons`)
- Confidence scoring per triple/fact

## 📝 Exchanges
- Stored with `role`, `content`, `timestamp`
- BM25 + semantic search for recall
- Auto-trimmed greeting/filler exchanges

## 📁 Files
- `entities.ts` — Entity CRUD + confidence scoring
- `triples.ts` — Triple store (S-P-O) + inference engine
- `exchanges.ts` — Exchange history management
- `types.ts` — Shared Zod schemas
