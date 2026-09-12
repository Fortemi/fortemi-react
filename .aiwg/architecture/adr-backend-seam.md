# ADR: Uniform tool-intent backend seam + capability negotiation

- **Status**: Accepted
- **Date**: 2026-06-16
- **Issue**: #191 (epic #190)
- **Supersedes / relates**: builds on the static-file backend (#189) and the physical snapshot backend (#187); the remote-server backend is explicitly out of scope here (deferred under #190). **Amended by ADR-013 (#322)**: the "write/merge stays PGlite/remote only" scoping is superseded — a canonical writable RecordStore tier without PGlite is introduced by #323.

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

### Remote Read Projection Amendment (#417, #418, #421)

The earlier extension-point assumption of shared JSON shapes does not hold for
the live server. Its note envelopes, directional links and revision/activity
graph require explicit validated projections. The server runtime handlers and
`matric-core` models remain authoritative; the supplemental producer #1146
capture is bound to released server 2026.9.9 and is not a shared storage schema.

`getNote` returns null only for an authoritative note-not-found Problem Details
response. Transport, authorization, invalid payload and relationship failures
throw bounded `RemoteBackendError` diagnostics without body text or credentials.
`getNoteFull` composes current revised content with links, concepts and
`provenanceGraph`; enrichment errors must not make an existing note appear absent.

Remote `provenanceGraphOf` preserves server field names and the distinct
activity, edge, current-chain and derived-note components. The legacy
`provenanceOf` local-edge projection is unsupported remotely and throws before
dispatch. PGlite and static-shard provenance remain unchanged. Remote links
retain endpoints, direction relative to the requested note and UTC timestamps;
self-links can occur in both directions. SKOS assignment tuples preserve their
assignment metadata. Unreturned alternate labels and definitions retain neutral
placeholders accompanied by `unavailableFields`, not a claim of known absence.

### Remote Search and Mutation Amendment (#419/#420)

The remote adapter sends `q` through the producer search endpoint, admitting
explicit fts/semantic/hybrid modes, bounded limits and comma-joined AND tags.
Nonzero offset and source filters are not implemented by this producer contract
and reject before dispatch. Returned totals count returned hits, not corpus size.
Search hits have no timestamps: bounded sequential detail enrichment supplies
validated UTC values without changing rank order. Enrichment is not atomic with
search, and failures reject the operation instead of inventing note metadata.

`RemoteSearchResult` preserves requested/effective mode and degradation.
`semanticWithReport` can return explicit FTS fallback; the older array-only
`semantic` rejects degraded responses so it cannot imply vector retrieval.
Backend capability `semantic: server` describes dispatch, not provider readiness.

Validated create/update/star/archive/delete/restore intents dispatch to actual
operation-specific REST methods. Create and content update disable AI revision;
create requests an empty pipeline. Restore retains server-side indexing behavior.
Unknown actions/fields and legacy tool/semantic path overrides reject before
dispatch. No automatic mutation retry or rollback guarantee is introduced.
Remote merge capability is false because no merge operation is implemented.

Producer #1146 owns separate 25-case read and 37-case operation captures, with
fixture-source and runtime identities independently pinned. Historical fixture
bytes remain unchanged. Fixture/source tests are not released-package
qualification; successful vector retrieval, auth/error runtime evidence, live
published-consumer execution and release closeout remain gates. Suite NO-GO is
unchanged.

### Native HTTP Evidence Amendment (#417/#418/#421, Producer #1146)

Producer commit `bb0c8509f7d5586ec34dfb40c0af58aa1bfd604d` additionally owns
21 controlled negative cases and a31-check/61-request published-Core receipt.
The consumer pins corpus, receipt and producer runner/helper independently,
then replays31 faults against current source. Socket reset/abort/truncation and
malformed/enrichment responses are injected; historical real loopback execution
is not a live Fortemi server run. Real native missing/invalid-identity401 already
proves note-route denial in personal required-authentication mode. Authenticated
role/tenant403 remains unqualified, not an implicit hosted implementation goal.
These supplements change neither wire semantics nor the separate persistence
planes. See the fixture README for the bounded UI-facing error contract.

The supplemental native capture at producer commit
`912c0636a6d2273e5663a977e0182bfe874c3bd3` adds historical real HTTP evidence for
published Linux AMD64 server 2026.9.9 and clean-installed published Core 2026.9.4.
Its 13 checks/86 calls include required API identity, 401/404/429/500 responses,
directional relationships and seeded provenance composition. The consumer pins
fixture, receipt and capture-script bytes separately from runtime executable and
published tarball identities. Existing 25/37-case pins and storage contracts do
not change. Server runtime handlers/models and ADR-102 remain authoritative.

Current consumer tests replay raw responses offline with exact note-route
method/path matching. The actual 403 came from operator inventory; injecting it
into note transports verifies error mapping only, not live note denial. Personal
AllowAllPolicy permits authenticated MCP-scoped note reads in this capture.
Hosted OIDC/JWT, multi-tenant denial, read-only mutation enforcement, successful
inference, full-operation qualification and other platforms remain outside this
evidence. Historical receipt cleanup is not current host-state proof. Source
replay does not qualify a new published consumer. Suite NO-GO and lane release
gates remain unchanged.

- `DataBackend`, `BackendCapabilities`, `selectBackend` live in core (`src/data-backend.ts`).
- PGlite adapter wraps the repositories/tools; static-file adapter wraps `ShardReader` (#189).
- Depends on #187 (snapshot/PGlite backend) and #189 (static-file backend) being available — implement after both land.
