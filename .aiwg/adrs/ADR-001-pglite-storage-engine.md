# ADR-001: PGlite as Browser Storage Engine

**Date**: 2026-03-20
**Status**: Accepted
**Deciders**: roctinam

---

## Context

fortemi-browser requires a browser-side storage engine that:
1. Supports schema evolution without data loss or manual store rebuilding
2. Provides full-text search parity with PostgreSQL `tsvector`
3. Provides vector search parity with `pgvector` (HNSW indexing, cosine similarity)
4. Supports complex SQL queries (StrictTagFilter AND/OR/NOT logic, temporal filters)
5. Has 1:1 type mapping with the server's PostgreSQL schema (format parity requirement)

## Decision

Use **PGlite** (`@electric-sql/pglite`) with the `@electric-sql/pglite/vector` extension, persisted to OPFS (`opfs://fortemi-{archive}`).

## Alternatives Considered

| Option | Schema evolution | FTS parity | Vector | Type mapping | Decision |
|---|---|---|---|---|---|
| **PGlite** | ✅ Real ALTER TABLE | ✅ Native tsvector | ✅ pgvector HNSW | ✅ Identical | **Chosen** |
| SQLite WASM | ✅ Standard migrations | ❌ FTS5 (differs) | ⚠️ extension (sqlite-vss) | ⚠️ Type translation | Rejected |
| IndexedDB (idb) | ❌ Store rebuild required | ❌ No native FTS | ❌ Full scan only | ❌ Type translation | Rejected |
| Dexie.js | ❌ Same as idb | ❌ No native FTS | ❌ Full scan only | ❌ Type translation | Rejected |

## Consequences

**Positive:**
- Schema migrations are standard SQL files; server `migrations/` is the reference
- `tsvector` FTS is identical to server — no ranking divergence to document
- `pgvector` HNSW index means vector search quality matches server exactly
- All SQL queries (StrictTagFilter, RRF fusion) are portable from server Rust → browser SQL
- `ALTER TABLE` works — schema evolution is a solved, first-class problem

**Negative / Risks:**
- PGlite is single-writer (one write connection per database); mitigated by PGlite Worker pattern (ADR-003)
- WASM bundle ~6-10MB; cached after first load
- PGlite startup time ~50-200ms on OPFS; acceptable, shown as loading state
- Not all PostgreSQL extensions are available; pgvector is explicitly supported
- Server migrations cannot be copied verbatim — must adapt DDL (remove ROLE/GRANT, check extension compatibility)

## Compliance

Browser migration files must track server migration files. When the server adds a migration, a browser-adapted version must be added at the same sequential number. Drift = sync breakage.
