# ADR-009: Pluggable Storage Backend Boundary

**Date**: 2026-05-23
**Status**: Proposed
**Deciders**: roctinam

---

## Context

ADR-001 selects PGlite as the default browser storage engine because Fortemi needs PostgreSQL-compatible migrations, full-text search, vector search, and server format parity. ADR-003 requires all writes to a physical PGlite database to flow through one writer.

Those decisions remain correct for the default browser package, but the current code exposes PGlite directly through `createPGliteInstance()` and hardwires `ArchiveManager` to create one PGlite instance per archive. That makes other reusable topologies harder than necessary:

- Tauri and desktop shells that want an encrypted local vault
- Applications that need a shared workspace store plus a private user store
- Tests that should inject deterministic storage clients
- Future read-only snapshot or import backends
- Consumers that need project-specific storage without forking repositories

## Decision

Introduce a narrow storage boundary in `@fortemi/core`:

- `QueryExecutor` for query/exec transaction handles
- `DatabaseClient` for query/exec/transaction clients
- `StorageBackend` for opened database clients with identity, mode, and close lifecycle
- `StorageBackendFactory` for archive-scoped backend creation
- `StorageTopology` for explicit multi-backend coordination policies

The existing PGlite implementation remains the default backend through `PGliteStorageBackendFactory`. `ArchiveManager` accepts either the existing `PersistenceMode` constructor path or an injected `StorageBackendFactory`.

Repositories depend on the query/transaction surface only. They do not choose physical storage and do not fan out writes across multiple backends.

## Consequences

### Positive

- Existing `new ArchiveManager('memory' | 'idb' | 'opfs')` callers keep working.
- PGlite remains the default storage engine and keeps ADR-001 format parity.
- Desktop and embedded consumers can provide storage implementations without changing repositories.
- Tests can inject fake backends for contract-level coverage.
- Multi-backend use cases are modeled explicitly instead of hidden inside repositories.

### Negative

- The storage API becomes part of the public core surface and must remain stable.
- Custom backends must match PGlite's query result shape closely enough for repository SQL expectations.
- The first iteration does not solve synchronization or conflict resolution.

### Risks

- A custom backend could violate PostgreSQL semantics expected by repositories.
  Mitigation: document the contract as SQL/PGlite-compatible, not a generic key-value store.
- Dual-backend consumers could accidentally create two write paths to the same physical store.
  Mitigation: require explicit topology/coordinator policy and preserve one writer per physical backend.

## Alternatives Considered

### Keep Waiting for BT6 Scope

Rejected. BT6 remains an important consumer, but the abstraction is broadly reusable across Fortemi deployment modes and tests.

### Repository-Level Backend Injection

Rejected. Making every repository aware of physical topology would spread coordination logic throughout the codebase and weaken ADR-003.

### Replace PGlite

Rejected. ADR-001's reasons still hold: SQL migrations, tsvector, pgvector, and server format parity are core requirements.

## Implementation

1. Add storage backend contracts in `packages/core/src/storage-backend.ts`.
2. Wrap current PGlite creation in `PGliteStorageBackendFactory`.
3. Update `ArchiveManager` to accept injected backend factories while preserving existing constructor behavior.
4. Move core repositories and tools to the narrow database contract.
5. Add contract tests for injected backends and default ArchiveManager behavior.
6. Document custom backend usage for desktop/Tauri consumers.

## Related Decisions

- ADR-001: PGlite as Browser Storage Engine
- ADR-003: PGlite Single-Writer Worker Pattern
- ADR-007: Deployment Modes
