# Progress: backend-agnostic data tiers (#187 / #189 / #191, epic #190)

## Task contract
- Original request: "you can merge the requirements of 188/189 we need to support a listed
  capabilities, ask me questions interactively to fill gaps then we will complete all work
  using address-issues"
- Completion criteria: #187, #189, #191 implemented + tested; per-issue PRs (pr-required,
  `Closes #N` in body, no AI attribution); typecheck/lint/test:core/build green; CI green;
  merge authorization requested (NO auto-merge).
- Authorization scope: implement the three scoped issues + the #191 ADR. Remote-server backend
  DEFERRED (do not implement). Don't expand beyond #187/#189/#191.

## Decisions (maintainer-confirmed)
- Semantic (static tier) = pluggable provider, 3 points: none(text/facets) / brute-force
  cosine (small static set) / prebuilt ANN snapshot (full corpus). Reader degrades to
  text/facets when unset.
- Static-tier capabilities (read-only): browse+get, FT+facet (PGlite parity: multi-word +
  doc dedup/(part X/N) collapse), links/tags/concepts, lazy NoteFull. No write/merge.
- Clustering: deliver BOTH the in-place reader AND clustered component layout now.
- Scope this round: #189 + #187 + #191 seam. Remote-server HTTP backend deferred.
- Build order: #187 & #189 (independent) → #191 (unifies, ADR-first).

## Current status
- Phase: #189 IMPLEMENTED on branch feat/189-static-file-reader (off main). Awaiting shard
  regression suite (bg), then commit + PR. Then #191.
- #189 done: shard/shard-reader.ts (openShard: browse/get, FT+facet w/ AND parity, links/
  concepts, lazy full, match-cache paging, URL+packed sources, clustered-read, min_reader_version
  guard); ShardManifest.layout + ShardClusterRef/ShardLayout types; exportShard clusterNotesSize
  emits notes/NNNNNN.jsonl + manifest.layout; importShard reads clustered notes; shard/
  semantic-providers.ts createCosineSemanticProvider (cosine-small; ANN = StaticSemanticProvider
  extension point, none=default); react useShard hook. Exports wired (shard/index + index + react
  index). Docs: integration.md §11 in-place reader subsection.
  Tests: shard-reader.test.ts 15 pass; shard-clustered.test.ts 2 pass (export→reader→import
  round-trip + monolithic-default regression). Typecheck core+react clean, lint clean, core build OK.
- #187 DELIVERED → PR #192 (open, mergeable, Closes #187). Branch feat/187-physical-archive.
- Done (requirements): #189 rewritten canonical (absorbs #188); #188 closed/superseded;
  #191 created (epic seam, ADR-first); all labeled; #190 scope comment posted.
- Done (#187): core `data-archive.ts` (dumpDbSnapshot/restoreDbSnapshot/verifyDbSnapshotMeta/
  DbSnapshotVersionError + SUPPORTED_PGLITE_VERSION/CURRENT_MIGRATION_HEAD/
  DB_SNAPSHOT_SCHEMA_VERSION); `createPGliteInstance` gains `{loadDataDir}` (CreatePGliteOptions);
  `ArchiveManager.adopt()` (no-migration adoption); React `FortemiProvider` snapshotUrl/
  snapshotExpectations props (main mode; worker deferred). Exports wired in index.ts.
  Naming: "snapshot" to avoid ArchiveManager(named store)/Shard collisions.
- Next action: confirm db+archive-manager suites green (bg run b5fsuegvj), add concise #187
  docs, commit, push, open PR (Closes #187). Then #189.

## Key facts learned
- Installed pglite = 0.4.1 (issue said 0.4.5 — wrong); has dumpDataDir(compression) +
  loadDataDir create option. compression: 'none'|'gzip'|'auto'.
- 9 migrations (head=9); schema_version table tracks MAX(version).
- DB creation+migrations live in ArchiveManager.open() (NOT create-fortemi.ts, which is just
  an event-bus factory). storage-backend.ts: StorageBackend extends DatabaseClient (query/exec/
  transaction/close); PGliteStorageBackend wraps PGlite. QueryResult = {rows: T[]}.
- VERSION const in index.ts = '2026.6.4'. Importing VERSION into data-archive would be a cycle
  → avoided; migration head computed from allMigrations.

## Failed approaches (do not retry)
- (none yet)

## State references
- Issues: #187 (open), #189 (open, canonical), #188 (closed superseded), #190 (epic, open),
  #191 (open, seam). Tasks #6–#11.
- Delivery policy: pr-required; remotes origin=Gitea primary, github=mirror; require_ci_green.
- Published release: v2026.6.4. main HEAD had #177/#178/#179 merged before this work.
