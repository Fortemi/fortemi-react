# ADR: Uniform tool-intent backend seam + capability negotiation

- **Status**: Accepted
- **Date**: 2026-06-16
- **Issue**: #191 (epic #190)
- **Supersedes / relates**: builds on the static-file backend (#189) and the physical snapshot backend (#187); the remote-server backend is explicitly out of scope here (deferred under #190).

## Context

A host app should code against **one uniform data-access surface**, with the backing store technology-agnostic and swappable by need. fortemi-react already has most of the pieces, but the backend abstraction sits at the wrong altitude:

- `StorageBackend extends DatabaseClient` (`query`/`exec`/`transaction`) is a **SQL-client seam**. It fits PGlite-local and PGlite-worker, and could fit a remote SQL proxy — but a **static-file backend (#189) cannot be a `DatabaseClient`**: it has no SQL engine. It answers *operations* (list/get/search) by reading component files, not by running SQL.
- There is already an operation-level vocabulary: the MCP tool surface (`searchTool`, `getNote`, `listNotes`, `manageNote`, `captureKnowledge`) and the service-worker routes (`createRoutes`/`matchRoute`/`RouteHandler`). These read like a uniform API but are implemented only over the SQL backend.
- `CapabilityManager` / `FortemiBridgeCapabilities` negotiate *feature* capabilities (embeddings, LLM) but not *backend-tier* capabilities (can this backend write? do semantic? merge?).

The gap: lift the backend seam from SQL up to the **operation (tool/route) intent** level, so a backend can satisfy a **capability-scoped subset** without being a SQL engine, and let the app negotiate which backend serves which feature.

## Decision

Introduce a backend seam defined in terms of **read/admin operations**, plus a capability descriptor and a selector. Three parts:

### 1. `DataBackend` — the operation interface

A backend implements the operations it can, to its tier. The read operations mirror the existing tool vocabulary so no new surface is invented:

```ts
interface DataBackend {
  readonly id: string
  readonly capabilities: BackendCapabilities
  // read ops (every backend that serves reads)
  listNotes(options?): Promise<{ items: NoteRecord[]; total: number }>
  getNote(id): Promise<NoteRecord | null>
  search(query, options?): Promise<SearchResult>
  linksOf(id): Promise<LinkRecord[]>
  conceptsOf(id): Promise<ConceptRecord[]>
  getNoteFull(id): Promise<NoteFullRecord | null>
  semantic?(query, k?): Promise<SemanticHit[]>      // capability-gated
  // write/admin ops (capability-gated; absent on read-only backends)
  manageNote?(input): Promise<...>
  // ...
}
```

- **PGlite backend** (shard-import or snapshot-restored, #187) implements the full set via the existing repositories/tools.
- **Static-file backend** (#189) implements the read-only subset by wrapping `openShard`'s `ShardReader` (its `listNotes`/`getNote`/`search`/`linksOf`/`conceptsOf`/`getNoteFull`/`semantic` map 1:1).
- **Remote-server backend** (deferred) will implement the full set over HTTP. The interface must leave room for it — see Extension point.

### 2. `BackendCapabilities` — the negotiated tier

Each backend advertises a capability descriptor:

```ts
interface BackendCapabilities {
  read: boolean            // browse/get/search/links/concepts/full
  write: boolean           // manage*/capture
  merge: boolean           // conflict-resolving import
  multiUser: boolean
  semantic: 'none' | 'cosine-small' | 'ann-full' | 'server'  // #189 tradeoff points + server
  startupCost: 'instant' | 'index-build' | 'network'
}
```

The static-file backend reports `{ read:true, write:false, merge:false, multiUser:false, semantic: <provider's point>, startupCost:'instant' }`. PGlite reports full read+write+merge with `semantic:'ann-full'`. This composes with — does not replace — `CapabilityManager`/`FortemiBridgeCapabilities`, which stay the home for *feature* (model) capabilities; backend capabilities describe *which operations the chosen store can serve*.

### 3. `selectBackend` — negotiation + selector

```ts
function selectBackend(
  requested: Partial<BackendCapabilities>,
  available: DataBackend[],
): { backend: DataBackend; capabilities: BackendCapabilities; missing: string[] }
```

The app declares the features it needs; the selector returns the lightest backend that satisfies them (or the closest, with `missing` listing the gaps so the UI **degrades gracefully** — e.g. hide a write button, or offer "upgrade to enable semantic"). Supports runtime upgrade/downgrade: a host can start on the static-file backend and switch to PGlite when a visitor opts into semantic, behind the same `DataBackend` calls.

## Out of scope (deferred under #190)

- **Remote-server HTTP backend** — a `DataBackend` proxying to the full Fortémi Rust/Postgres server (full read/write/semantic/multi-user). This ADR defines the seam so it slots in as another `DataBackend` with `semantic:'server'`, `multiUser:true`; it is not implemented here.
- **Write/merge over static files** — stays PGlite/remote only.

## Extension point (remote backend readiness)

The interface is operation-shaped, not SQL-shaped, specifically so the remote backend is *just another implementation*: its `search`/`getNote`/`manageNote` proxy to HTTP endpoints that already share the JSON format-parity the package guarantees. Optional ops (`semantic?`, `manageNote?`) are capability-gated, so a backend implements only what its tier supports without interface churn.

## Consequences

**Positive**
- Identical host code across the static-file, PGlite, and (future) remote tiers; only the negotiated capability set differs.
- The static-file backend (#189) becomes a first-class peer of PGlite without being forced into a SQL shape.
- Graceful degradation is explicit (`missing`) rather than runtime errors.

**Negative / risks**
- A second abstraction over the existing `StorageBackend` SQL seam — kept thin (the read ops delegate to repositories/`ShardReader`; no logic duplication).
- The operation interface must track the tool vocabulary; drift is mitigated by reusing the existing tool/route types as the source of truth.

**Neutral**
- Existing PGlite paths are unchanged (additive). The seam is opt-in: a host that only uses PGlite need not adopt `selectBackend`.

## Implementation notes

- `DataBackend`, `BackendCapabilities`, `selectBackend` live in core (`src/data-backend.ts`).
- PGlite adapter wraps the repositories/tools; static-file adapter wraps `ShardReader` (#189).
- Depends on #187 (snapshot/PGlite backend) and #189 (static-file backend) being available — implement after both land.
