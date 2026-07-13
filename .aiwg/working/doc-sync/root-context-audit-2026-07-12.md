# Root Context Doc Audit — 2026-07-12

Direction: code-to-docs (code is source of truth). Scope: CLAUDE.md, AIWG.md, README.md, AGENTS.md (reference check only). No files edited.

## Commands run and outputs

### 1. Test files and test count

```
$ find packages/core/src/__tests__ -name '*.test.ts' | wc -l
58
```
(Includes `shard/shard-conformance.spike.test.ts` — the `.spike.test.ts` file matches `*.test.ts`.)

```
$ timeout 120 pnpm --filter @fortemi/core exec vitest list 2>/dev/null | wc -l
1061
```
Head/tail inspection confirmed every line of `vitest list` output is a test entry (`file > suite > test`), no header/footer lines. Authoritative count: **1,061 tests across 58 files**.

Cross-check (approximate): `grep -rE "^\s*(it|test)\(" packages/core/src/__tests__ | wc -l` → 1051; plus 3 `it.each/test.each` occurrences (each expands to multiple tests) — consistent with 1,061.

Doc claims:
- CLAUDE.md:17 `Vitest 4.1.0 (1,052 core tests across 56 files; ...)` — WRONG (1,061 / 58)
- CLAUDE.md:40 `pnpm test:core # 1,052 unit/integration tests` — WRONG
- CLAUDE.md:90 `1,052 tests across 56 files` — WRONG
- AIWG.md:19 `991 core tests across 54 files` — WRONG and diverges from CLAUDE.md
- AIWG.md:42 `# 991 unit/integration tests` — WRONG
- AIWG.md:92 `991 tests across 54 files` — WRONG

### 2. Migrations

```
$ ls packages/core/src/migrations/
0001_initial_schema.ts ... 0009_vector_selector_performance.ts
0010_attachment_text_metadata.ts
0011_embedding_member_metadata.ts
0012_embedding_configs.ts
0013_templates.ts
0014_url_links.ts
0015_embedding_set_server_metadata.ts
0016_embedding_server_metadata.ts
index.ts
```
16 numbered migrations. 0010 = attachment text metadata; 0011–0016 = embedding member metadata, embedding configs, templates, url links, embedding-set server metadata, embedding server metadata.

- CLAUDE.md:74 (`16 numbered migrations; 0010 ... 0011–0016 cover embedding, template, URL-link, and server-metadata parity`) — CORRECT.
- AIWG.md:76 (`10 numbered migrations ... 0010 adds attachment MIME and extracted-text metadata`) — WRONG (16, not 10) and diverges from CLAUDE.md.

### 3. Hooks

```
$ ls packages/react/src/hooks/ | wc -l
30
$ grep -oE "use[A-Za-z]+" packages/react/src/index.ts | sort -u | wc -l
31   (30 hooks + useFortemiContext, exported from FortemiProvider.tsx at index.ts:1)
```
All 31 names match the 31-row table in CLAUDE.md/AIWG.md exactly (useAiwgIndex … useUpdateNote, incl. useFortemiContext, useRemote, useShard, useShardPrefetch, useGraphController, useCommunities, useSimilarityGraph, useEmbeddingSets, useEmbeddingWorker).

- CLAUDE.md:83 / AIWG.md:85 (`30 hook modules exporting 30 hooks; useFortemiContext brings the package export surface to 31 hooks`) — CORRECT.

### 4. Capabilities

```
$ ls packages/core/src/capabilities/ | wc -l
14
```
(auto-tag, chunking, embedding-handler, embed-worker-transport, fallback-router, gpu-detect, inference-detect, inference-provider, llm-handler, llm-loader, local-discovery, openai-provider, provider-registry, semantic-loader)
- Claim "14 files" — CORRECT (both docs).

### 5. Repositories

```
$ ls packages/core/src/repositories/
attachments, collections, communities, embedding-sets, graph, links, notes,
provenance, search, skos, tags (-repository.ts)  + condition-builder.ts, note-text.ts, types.ts
```
11 `*-repository.ts` data-access repositories — claim "11 data access repositories" CORRECT (both docs; the listed names match).

### 6. Tools

```
$ ls packages/core/src/tools/
capture-knowledge, get-note, list-notes, manage-archive, manage-attachments,
manage-capabilities, manage-collections, manage-links, manage-note, manage-tags,
search (.ts) + index.ts, manifest.ts, schemas.ts
```
11 tool function files, names match the docs' list — claim "11 MCP tool functions" CORRECT (both docs).

### 7. Test dirs: db-table-parity vs format-parity

```
$ ls packages/core/src/__tests__/
... db-table-parity  security  shard  ...   (no format-parity/)
```
- CLAUDE.md:90 references `db-table-parity/` — CORRECT.
- AIWG.md:92 references `format-parity/` — WRONG (directory does not exist); divergence from CLAUDE.md.
- Also present but unmentioned: `security/` test subdir (informational only).

### 8. Dependency versions

```
$ grep package.json files:
root:                "version": "2026.7.3", "packageManager": "pnpm@10.6.5", "eslint": "^9.0.0"
packages/core:       "@electric-sql/pglite": "^0.4.1", "vitest": "^4.1.0"
packages/react:      "react" peer ^19.0.0, devDep "react": "^19.2.4", "vitest": "^4.1.0",
                     "react-force-graph-3d": "^1.29.1" (optional peer + devDep)
apps/standalone:     "react": "^19.2.4", "vite": "^7.3.1", "@playwright/test": "^1.52.0"
```
Tech Stack claims (React 19.2.4, PGlite 0.4.1, Vite 7.3.1, pnpm 10.6.5, Vitest 4.1.0, Playwright 1.52.x, ESLint 9.x) — ALL CORRECT. Current version 2026.7.3 — CORRECT.

### 9. Architecture / recent features

```
$ ls packages/core/src/shard/
blob-sidecar.ts checksum.ts field-mapper.ts index.ts parse.ts prefetch.ts
schema-validator.ts semantic-providers.ts shard-export.ts shard-import.ts
shard-reader.ts shard-tar.ts types.ts

$ grep blake3:
packages/core/src/hash.ts:2: import { blake3 } from '@noble/hashes/blake3'
packages/core/src/shard/blob-sidecar.ts:6-8: BLAKE3 digest ... blake3:<hex> → blobs/<hex>
Used by: attachments-repository.ts, shard-export/import tests, blob-roundtrip.test.ts
```
- CLAUDE.md:55 / AIWG.md:57 Knowledge Shard bullet (`tar.gz bundles with checksums, conflict strategies, field-mapped JSON format parity`) — MISSING blob sidecar + BLAKE3 attachment hashing (shipped feature, commit "portable blob sidecar round-trip + BLAKE3 attachment hashing").
- CLAUDE.md:78 / AIWG.md:80 shard/ Key Files row (`tar packaging, checksums, field-mapper, types, and shard↔server conformance harness`) — MISSING blob-sidecar (also parse/prefetch/schema-validator/semantic-providers, informational).

```
$ packages/react/src/graph-3d.ts + components/
ForceGraph3DView.tsx, SigmaGraphView.tsx, GraphView.tsx exist.
graph-3d.ts: exports ForceGraph3DView (react-force-graph-3d / Three.js, optional peer dep)
package.json exports: ".", "./graph", "./graph-2d", "./graph-3d"
```
- CLAUDE.md:29 / AIWG.md:31 (`packages/react/ — React hooks, FortemiProvider, GraphView (uses @fortemi/graph)`) — STALE: missing 3D graph view (ForceGraph3DView via `@fortemi/react/graph-3d`, optional `react-force-graph-3d` peer) and 2D/Sigma renderer tiers/subpath exports.

### 10. README.md

- Positioning (lines 5, 30, 32) matches the "browser edition of the Fortémi intelligent-database stack" repositioning — CORRECT.
- No test-count, hook-count, or migration-count claims found (grep for 1,052/991/counts: none) — no counter drift.
- README:101–104 package table matches actual monorepo packages; README:103 `@fortemi/react` row lists hooks/provider only, no graph-view/3D mention (minor staleness, same class as CLAUDE.md:29).

### 11. AGENTS.md

- AGENTS.md:7 `See [AIWG.md](./AIWG.md)`; lines 78, 92–94 reference `.aiwg/AIWG.md` and root `AIWG.md` consistently. Does not reference CLAUDE.md (expected — it is the codex-provider bridge). CONSISTENT; no finding.

## Summary of divergences between CLAUDE.md and AIWG.md (AIWG.md should mirror CLAUDE.md)

| Claim | CLAUDE.md | AIWG.md | Code truth |
|---|---|---|---|
| Test count/files | 1,052 / 56 | 991 / 54 | 1,061 / 58 |
| Migrations | 16 (0010–0016 described) | 10 | 16 |
| Parity test dir | db-table-parity/ | format-parity/ | db-table-parity/ |
