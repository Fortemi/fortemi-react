# ADR-003: PGlite Single-Writer Worker Pattern

**Date**: 2026-03-20
**Status**: Accepted
**Deciders**: roctinam

---

## Context

PGlite does not support concurrent write connections to the same OPFS database. Multiple simultaneous writers (e.g., Service Worker + main thread) would corrupt the WAL.

The application has multiple potential writers:
- React UI (user actions)
- Service Worker (MCP tool calls from agents)
- Job Queue Worker (background processing)

## Decision

Route **all writes** through a single dedicated **PGlite Worker** using message-passing (`postMessage` / `MessageChannel`). Read-only queries may use separate PGlite instances opened in read-only mode.

```
Main Thread     →  postMessage(query)  →  PGlite Worker  →  PGlite (OPFS)
Service Worker  →  postMessage(query)  →  PGlite Worker  →  PGlite (OPFS)
Job Worker      →  postMessage(query)  →  PGlite Worker  →  PGlite (OPFS)
```

**Message protocol:**
```typescript
// Request
{ id: string, type: 'query' | 'transaction', sql: string, params: unknown[] }

// Response
{ id: string, rows: Record<string, unknown>[], error?: string }
```

## Read Strategy

For read-heavy operations (search, listing), a separate read-only PGlite connection is acceptable:
- Open same OPFS database with `{ readOnly: true }`
- Use for `SELECT` queries only
- Slightly stale reads are acceptable (eventual consistency within the same device)

## Consequences

**Positive:**
- No WAL corruption possible — single writer guarantee
- All mutations are serialized with natural ordering
- Simple to reason about transaction boundaries

**Negative:**
- All writes go through message-passing overhead (~0.1-1ms per query)
- Worker must be initialized before any app code runs — startup dependency
- Requires shared reference to worker across all repositories (singleton pattern)

## Implementation Note

The PGlite Worker is started at app initialization, before React renders. All repository instances receive a reference to the worker proxy. The worker exposes a promise-based API:

```typescript
class PGliteProxy {
  async query<T>(sql: string, params?: unknown[]): Promise<T[]>
  async transaction<T>(fn: (tx: PGliteProxy) => Promise<T>): Promise<T>
}
```
