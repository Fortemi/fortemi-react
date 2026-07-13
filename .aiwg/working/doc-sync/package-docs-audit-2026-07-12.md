# Package Docs Drift Audit — 2026-07-12 (code → docs)

Direction: code is source of truth. Scope: packages/core/README.md, packages/graph/README.md,
packages/react/README.md, packages/core/schemas/README.md, docs/api-reference.md,
docs/content/api-reference.md. No files edited.

## File existence

```
$ ls docs/api-reference.md docs/content/api-reference.md
ls: cannot access 'docs/api-reference.md': No such file or directory
docs/content/api-reference.md   (2239 lines)
```
Only ONE api-reference exists — no duplicate/divergence question. All README doc links
already point at `docs/content/api-reference.md` (e.g. packages/core/README.md:310).

## Code inventories (evidence)

### Shard module — packages/core/src/shard/index.ts
```
$ grep -n "export" packages/core/src/shard/index.ts
79: export { exportShard } from './shard-export.js'
82: export { importShard } from './shard-import.js'
95: export { openShard } from './shard-reader.js'
110: export { createCosineSemanticProvider } ...
115: export { ... prefetch ... }
51: export { sha256Hex, validateChecksums } from './checksum.js'
```
All re-exported from packages/core/src/index.ts (grep confirmed `exportShard: 1`,
`importShard: 1`, `openShard: 1` occurrences in the root barrel).

### Blob sidecar + BLAKE3
packages/core/src/shard/blob-sidecar.ts:6-8:
```
 * `<hex>` is the bare 64-char lowercase BLAKE3 digest of the entry bytes. A
 * projection record's `checksum` of `blake3:<hex>` resolves to `blobs/<hex>`
```
Exports: SIDECAR_PREFIX, blobChecksumToHex, sidecarEntryName, isSidecarEntry,
collectSidecarBlobs. `grep -rln blake3 packages/core/src` → hash.ts, shard/blob-sidecar.ts,
repositories/attachments-repository.ts (all via @noble/hashes).

### importShard error contract
packages/core/src/shard/shard-import.ts:77-130 — `importShard(...): Promise<ImportResult>`;
on unpack failure it `return { success: false, counts, skipped, warnings, ... }` (line ~125),
not a rejection. `ImportResult.success: boolean` (types.ts:215). Sidecar blobs hydrated to
BlobStore after transaction commit (comment lines 90-93).

### openShard checksum behavior
packages/core/src/shard/shard-reader.ts:154, 215 — checksum validation is lazy, at
component `read()` time against `manifest.checksums`, throwing
`Checksum validation failed for shard component: <name>` on mismatch.

### @fortemi/graph exports — packages/graph/src/index.ts
layout/filter/color/degree/bounds/neighborhood/serialize PLUS:
```
85: export { applyControlFilters, communityLegend } from './contract.js'
92: export { renderCommunityGraph } from './render-dom.js'
(65-83: mapCommunityGraph, bakeRenderGraph, stringifyRenderGraph, loadRenderSnapshot from render-prep)
100: export { GraphController } from './controller.js'
```
LayoutOptions (layout.ts:22-57) includes seed, ticks, nodeRadius, linkDistance,
linkStrength, chargeStrength, collisionPadding, communityStrength, boundsPadding,
pinned (line 50), initialPositions (line 57).
packages/graph/package.json: dependencies = { "@fortemi/core": "workspace:*" }, no peers.

### @fortemi/react — packages/react/src/index.ts + subpaths
Root barrel: FortemiProvider, useFortemiContext, 30 hooks, GraphView (lines 49-50).
Components dir: GraphView.tsx, SigmaGraphView.tsx, ForceGraph3DView.tsx.
package.json exports map: ".", "./graph", "./graph-2d", "./graph-3d".
tsup.config.ts entries: index, graph, graph-2d, graph-3d.
graph-2d.ts exports SigmaGraphView; graph-3d.ts exports ForceGraph3DView
("issue #262" / "issue #263" — SHIPPED).

### Schemas dir
```
$ ls packages/core/schemas/
aiwg-fortemi-index-export.schema.json
aiwg-fortemi-index-export.schema.receipt.json
knowledge-shard.schema.json
README.md
```

### Tool surface check (core README:276-280)
tools/manifest.ts registers 10 named tools (Capture Knowledge … Manage Capabilities);
tools/ dir has 11 tool modules incl. manage-attachments.ts. README claim "10 bridge-visible
+ 11 direct helpers incl. manageAttachments" — MATCHES code. Not a finding.

### api-reference.md useImportShard check (lines 1968-1981)
Documented `{ importShard(file, strategy?), importFromUrl(url, strategy?, prefetchOptions?),
isImporting, progress, error, result }` matches useImportShard.ts:19-104. Accurate.

## Findings (details)

1. HIGH — packages/graph/README.md:180-181 ("Choosing a Renderer" table):
   `| **Interactive 2D** | Sigma tier (planned, #263) | ...` and
   `| **3D** | \`Graph3D\` (planned, #262) | ...`
   Both shipped: `SigmaGraphView` via `@fortemi/react/graph-2d`, `ForceGraph3DView` via
   `@fortemi/react/graph-3d`. No component named `Graph3D` exists anywhere
   (`grep -rn "Graph3D" packages/react/src` → only ForceGraph3DView*).

2. MEDIUM — packages/core/README.md:42 and :265 (Knowledge Shards rows) list
   "set-scoped exports, chunked imports, checksums, JSON format parity" but omit the
   portable attachment blob sidecar (`blobs/<blake3-hex>` tar entries, post-commit
   BlobStore hydration) and BLAKE3 attachment hashing shipped in blob-sidecar.ts.

3. LOW — packages/core/README.md:72: "`@noble/hashes` | SHA hashing for content and
   integrity checks" — the same dependency now also supplies BLAKE3 digests for
   attachments/blob sidecar (hash.ts, attachments-repository.ts, blob-sidecar.ts).

4. MEDIUM — packages/core/schemas/README.md:1-14 documents ONLY
   aiwg-fortemi-index-export.schema.json + receipt. `knowledge-shard.schema.json` (present
   in the same dir, used by shard/schema-validator.ts) is undocumented, and the pin/refresh
   procedure text does not say whether it applies to that file.

5. MEDIUM — docs/content/api-reference.md TOC (lines 8-42) + @fortemi/core body: NO
   Knowledge Shard section. `exportShard`, `importShard`, `openShard`, `prefetchShard`,
   blob-sidecar helpers and `createCosineSemanticProvider` are public core exports with no
   API docs; consequently the new structured `{success:false}` ImportResult contract and
   openShard lazy per-component checksum behavior are documented nowhere.

6. MEDIUM — docs/content/api-reference.md: no `@fortemi/core/aiwg-index` subpath section
   (createAiwgIndexController, createAiwgFetchChunkLoader, chunked v2/source.graph export,
   hybrid embedding helpers). Only incidental mentions at lines 1511 and 2176-2183
   (useAiwgIndex hook).

7. MEDIUM — docs/content/api-reference.md:1563-1630 "Graph Helpers" omits exported API:
   renderCommunityGraph (render-dom), mapCommunityGraph / bakeRenderGraph /
   stringifyRenderGraph / loadRenderSnapshot (render-prep), applyControlFilters /
   communityLegend (contract), and the GraphController class (only prose mention at 1516).

8. MEDIUM — docs/content/api-reference.md @fortemi/react section (1630+) documents hooks
   only: no GraphView / SigmaGraphView / ForceGraph3DView component reference and no
   `/graph`, `/graph-2d`, `/graph-3d` subpath documentation (grep for
   "SigmaGraphView|ForceGraph3D|graph-2d|graph-3d" → zero hits).

9. LOW — docs/content/api-reference.md:1567-1570 `layoutCommunityGraph` options typed as
   `{ algorithm?, width?, height? }`; actual LayoutOptions (layout.ts:22-57) adds seed,
   ticks, nodeRadius, linkDistance, linkStrength, chargeStrength, collisionPadding,
   communityStrength, boundsPadding, pinned, initialPositions.

10. LOW/INFO — docs/api-reference.md does not exist; only docs/content/api-reference.md.
    No divergence to report; any tooling or prompts referencing docs/api-reference.md
    point at a nonexistent path.

## Explicitly checked, NOT drifted
- core README tool counts (10 manifest / 11 helpers) — correct.
- graph README API table incl. mapCommunityGraph/bakeRenderGraph/loadRenderSnapshot,
  renderCommunityGraph, applyControlFilters/communityLegend — current.
- react README hooks table (30 hooks) matches src/index.ts; SigmaGraphView/ForceGraph3DView
  subpath docs (lines 183-217) match graph-2d.ts/graph-3d.ts and package.json exports.
- api-reference useImportShard/useShardPrefetch signatures — match hooks.
- graph README "No peer dependencies" — true (core is a regular dependency, stated at line 7).
