# Doc-Sync Audit — 2026-07-12

- **Direction**: code-to-docs (code is source of truth)
- **Scope**: incremental — commits since last doc-sync (2026-07-01), ~29 merges: shard blob sidecar + BLAKE3 hashing (#271), aiwg-index hardening (#284–#297), migrations 0011–0016, 3D graph view (#262/#263/#279), docs repositioning (#274)
- **Auditors**: 2 (root context docs; package READMEs + API docs)
- **Evidence**: `.aiwg/working/doc-sync/root-context-audit-2026-07-12.md`, `.aiwg/working/doc-sync/package-docs-audit-2026-07-12.md`

## Findings by Severity

### High (fixed)

| # | File | Drift | Fix |
|---|---|---|---|
| 1 | `CLAUDE.md` (3 places) | "1,052 core tests across 56 files" | 1,061 tests / 58 files (verified via `vitest list`) |
| 2 | `AIWG.md` (3 places) | "991 core tests across 54 files" (doubly stale; diverged from CLAUDE.md) | 1,061 tests / 58 files |
| 3 | `AIWG.md` Key Files | "10 numbered migrations … `0010` adds attachment MIME" | 16 migrations, 0011–0016 described (now mirrors CLAUDE.md) |
| 4 | `AIWG.md` Testing | references nonexistent `format-parity/` dir | `db-table-parity/` |
| 5 | `packages/graph/README.md` renderer table | "Sigma tier (planned, #263)", "`Graph3D` (planned, #262)" — both shipped | `SigmaGraphView` (`@fortemi/react/graph-2d`), `ForceGraph3DView` (`@fortemi/react/graph-3d`) |
| 6 | `README.md` guide table | all 8 doc links pointed at pre-reorg paths (`docs/*.md`) | repointed to `docs/content/**`; Package Architecture → `.aiwg/architecture/package-architecture.md` (the only in-repo file matching the row's description — consider promoting to `docs/content/` later) |

### Medium (fixed)

| # | File | Drift | Fix |
|---|---|---|---|
| 7 | `CLAUDE.md` + `AIWG.md` Knowledge Shard bullet & `shard/` row | missing blob sidecar / BLAKE3 attachment hashing | mentioned in both places, both files |
| 8 | `CLAUDE.md` + `AIWG.md` + `README.md` `@fortemi/react` descriptions | missing 2D/3D graph views | GraphView, SigmaGraphView, ForceGraph3DView noted |
| 9 | `packages/core/README.md` (rows 42, 265) | shard feature rows missing blob sidecars (BLAKE3) | added |
| 10 | `packages/core/schemas/README.md` | `knowledge-shard.schema.json` entirely undocumented | added "local authority" section |

### Low (fixed)

| # | File | Drift | Fix |
|---|---|---|---|
| 11 | `packages/core/README.md` deps table | `@noble/hashes` row omitted BLAKE3 use | updated |
| 12 | `docs/content/api-reference.md` `layoutCommunityGraph` | options shown as 3 fields; actual `LayoutOptions` has 14 | full `LayoutOptions` interface documented |

### API documentation gaps (RESOLVED — authored same day, curated depth per operator decision)

Originally flagged as human-review items; authored in a follow-up pass with operator-approved curated depth (primary entry points documented fully, low-level helpers in compact tables). New sections in `docs/content/api-reference.md` (+422 lines, TOC updated):

1. **Knowledge Shards** (`### Knowledge Shards`, under @fortemi/core) — `exportShard`/`ExportOptions` (incl. `includeBlobs` BLAKE3 sidecar), `importShard`/`ImportOptions`/`ImportResult` with the structured `{success:false}` error contract and sidecar hydration, `openShard`/`ShardReader` with lazy per-component checksum validation and `min_reader_version` fallback, `createCosineSemanticProvider`, `prefetchShard` warm API, schema validators + field-mapper table. Note: blob-sidecar helpers (`collectSidecarBlobs` etc.) are **internal** — audit finding corrected; documented as pipeline behavior, not standalone API.
2. **AIWG Index** (`### AIWG Index (@fortemi/core/aiwg-index)`) — `createAiwgIndexController` (full interface), `queryAiwgFortemiIndex`/`queryAiwgSemanticIndex`/`queryAiwgHybridIndex` + options/result types, `buildAiwgChunkedIndex` + fetch loaders (v2 `source.graph` noted), `buildAiwgStaticEmbeddingSet`/`findAiwgStaticDuplicatePairs`, validate/assert pairs table (total validators), projection + utility table.
3. **@fortemi/graph** — new `### Render Pipeline` (`mapCommunityGraph`, `bakeRenderGraph`, `stringifyRenderGraph`, `loadRenderSnapshot`, guards, `communityRanks`), `### Control Contract` (`applyControlFilters`, `communityLegend`, `GraphControlFilters`), `### SVG Renderer` (`renderCommunityGraph` + options + handle), `### GraphController` (class surface).
4. **@fortemi/react** — new `### Graph Views and Subpath Exports` — subpath/peer-dep table (`/graph`, `/graph-2d`, `/graph-3d`), `GraphView`/`SigmaGraphView`/`ForceGraph3DView` prop interfaces; root re-export note corrected against code (only `GraphView` is on the root).

## Verified Correct (no change)

Hooks (30 modules / 31 exports, table matches), capabilities (14 files), repositories (11), MCP tools (11), all Tech Stack versions, version 2026.7.3, README positioning ("browser edition of the Fortémi intelligent-database stack"), core README tool counts, graph README API table, react README hook table + 2D/3D subpath sections, `useImportShard`/`useShardPrefetch` signatures.

## Files Changed

- `CLAUDE.md`, `AIWG.md`, `README.md`
- `packages/core/README.md`, `packages/core/schemas/README.md`, `packages/graph/README.md`
- `docs/content/api-reference.md`

## Validation

- All 8 README guide-link targets verified to exist on disk
- No source code changed → no build/test run required
- No `lint:claude-context` script in this repo; markdown-only edits
