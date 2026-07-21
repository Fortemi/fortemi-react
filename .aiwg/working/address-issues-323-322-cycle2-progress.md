# Progress: address-issues #323 (cycle 2) + #322 close-out

## Task contract
- Original request: `/goal address-issues` for Fortemi/fortemi-react #323 (writable no-PGlite RecordStore w/ Bytecask attachments) and #322 (single Bytecask substrate epic).
- Completion criteria: remaining #323 cycle-2 scope implemented + tested + PR open (delivery: pr-required, CI green); AL CYCLE comments posted to #323 and #322; PR carries `Closes #323` (and closes #322 if all epic criteria met). No self-merge (harness-denied); leave PR ready-to-merge.
- Authorization scope: fortemi-react changes via branch+PR only.

## Current status
- Phase: MERGED. Operator explicitly authorized merge; PR #350 merged to main (565c354, branch deleted). Issues #323 and #322 auto-closed at 2026-07-17T02:09-04:00.
- Post-merge main CI run #426 (id 21231) completed successfully.
- No other open PRs on Fortemi/fortemi-react or roctinam/bytecask. github mirror push is a release-time obligation only (push_on_release) — not triggered by this merge.
- COMPLETE. No implementation, CI, merge, or tracker action remains.

## Implemented scope (from roctibot cycle-1 comment on #323)
1. Writable non-PGlite DataBackend record tier → `packages/core/src/records/record-backend.ts` (`createRecordBackend`): capabilities read+write+merge, semantic 'none', startupCost 'instant'; manageNote mirrors tools/manage-note actions (update/delete/restore/archive/unarchive/star/unstar) via ManageNoteInputSchema; omit conceptsOf/provenanceOf (canonical tier doesn't hold them — explicit unsupported).
2. DB-free shard round-trip → `packages/core/src/records/record-shard.ts`: `exportShardFromRecords` (notes.jsonl/collections.json/tags.json/links.jsonl + manifest + optional blobs/<hex> sidecar via BlobStore; reuse field-mapper/shard-tar/checksum/blob-sidecar) and `importShardToRecords` (unpack → manifest+version check → signature policy (reuse enforceSignaturePolicy — must export it from shard-import.ts) → checksums → put records; unsupported components (templates/embeddings/skos/provenance/graph/communities) → warnings + skipped counts; sidecar hydration after records commit via blobStore.put).
3. Note-tier PGlite projection + rebuild parity tests → `packages/core/src/records/record-projection.ts` (`projectNotes` upserting note/note_original/note_revised_current/note_tag/link/collection/collection_note; `projectRecords` = notes+attachments; attachment-projection.ts comment explicitly defers note projection to this cycle). collection_note SQL PK is (collection_id,note_id) w/ position+added_at (canonical created_at→added_at, position 0).

## Test coverage delivered
- __tests__/records/record-backend.test.ts (DB-free conformance, MemoryRecordStore)
- __tests__/records/record-shard.test.ts (round-trip + sidecar bytes + cross-import: record-exported shard accepted by DB importShard into PGlite = format parity; unsupported-component warnings)
- __tests__/records/record-projection.test.ts (canonical CRUD → projectRecords → row parity; drop+rebuild parity; re-project idempotent)

## Key facts
- Canonical records mirror SQL rows (ISO strings); content_hash format `blake3:<hex>`; sidecar entry `blobs/<bare-hex>`.
- LinkRecord0 has no confidence → linkToShard needs confidence:null shim. Canonical tier has no url links.
- ShardManifest: version CURRENT_SHARD_VERSION, format SHARD_FORMAT, matric_version VERSION (from ../index.js — beware circular import in records/: import VERSION carefully or hardcode via same import as shard-export).
- Test conventions: fake-indexeddb/auto, MemoryRecordStore, MemoryBlobStore, PGlite.create({extensions:{vector}}) + MigrationRunner(allMigrations); 30s suite timeout for multi-PGlite tests.
- pnpm test:core; typecheck; lint before PR.

## Failed approaches (do not retry — carried from prior session)
- Self-merging PRs — harness-denied. Leave ready-to-merge.
- `git checkout main` — main held by sibling worktree fortemi-react-release-2026.7.5; branch from origin/main.

## State references
- Issues: Fortemi/fortemi-react#323 (comment 85480 = cycle-1 status), #322 (comment 85413).
- Cycle-1 merges: #332–#337 all on main. Current main head: 5013e09.
