# AIWG CRM Integration

Fortemi React can consume AIWG project index exports produced by aiwg-crm and future
AIWG index tooling. The first supported contract is `aiwg.fortemi.index.export.v1`.

## Contract

An export contains a deterministic `items[]` array. Each record includes:

- stable `id`, `type`, and source locator,
- display `title` and searchable `text`,
- structured `facets`, `tags`, and `concepts`,
- `relationships` to CRM and AIWG records,
- field-level `provenance`,
- privacy classification and PII flag,
- `updated_at` timestamp.

Use `validateAiwgFortemiIndexExport(value)` or
`assertAiwgFortemiIndexExport(value)` before using untrusted exports.

Static sites and no-bundler hosts can import only the AIWG index helpers without
loading PGlite, workers, shard code, or browser storage:

```typescript
import {
  createAiwgIndexController,
  queryAiwgFortemiIndex,
} from '@fortemi/core/aiwg-index'
```

## Query

`queryAiwgFortemiIndex(index, query, options)` searches title/text/tags/concepts and
filters by type, facets, tags, concepts, privacy, and relationship target.

By default, query results preserve the deterministic export order. Pass
`rank: true` to sort matches by weighted title, tag, concept, and text hits, and
override `weights` when a host app needs a different lookup policy. Pass
`snippets: true` to include plain text snippets in `rankedItems`; Fortemi does
not inject markup into snippets. `includeMatches: true` exposes the fields that
matched so host apps can render their own highlights.

## Static Documentation Records

Exports may include `docs.page` records for documentation, README, and other
static content that should participate in lookup alongside CRM and AIWG records.
Static page records use the same source locator, facets, tags, concepts,
provenance, privacy, ranking, and snippet behavior as CRM records, which lets a
host replace bespoke documentation search without changing the query helper.

## Rich Static Metadata

The flat fields above remain the search and filter surface. Full records can
also include optional rich metadata for documentation UIs that render Fortemi
metadata in-page without opening or importing a Knowledge Shard:

- `skos_concepts`: concept ids plus labels, definitions, schemes, notation, URIs,
  alternate labels, and structured metadata.
- `skos_relations`: `broader`, `narrower`, `related`, or project-specific SKOS
  concept edges.
- `provenance_events`: W3C PROV-style activity records with agents, timestamps,
  source paths, confidence/privacy, and attributes.
- `relationships[*].metadata`: optional relationship labels, confidence,
  privacy, and structured metadata.

These fields are additive to `aiwg.fortemi.index.record.v1`. Existing consumers
can ignore them and continue querying the flat fields. Chunked indexes with a
projection keep rich metadata in detail records; call `getRecord(id)` before
rendering a metadata panel.

## Chunked Static Indexes

For large browser-only indexes, host a chunk manifest and part files instead of
one full export. This keeps static hosts compatible with CDNs and object storage
while avoiding a single full download and full in-memory `items[]` array.

Manifest files use `aiwg.fortemi.index.chunk-manifest.v1`:

```json
{
  "schema_version": "aiwg.fortemi.index.chunk-manifest.v1",
  "generated_at": "2026-06-15T00:00:00.000Z",
  "source": { "repo": "example/docs", "privacy": "public" },
  "total": 4400,
  "part_size": 250,
  "facets": { "type": { "docs.page": 4400 } },
  "parts": [
    { "href": "part-0000.json", "offset": 0, "count": 250 },
    { "href": "part-0001.json", "offset": 250, "count": 250 }
  ]
}
```

Each part uses `aiwg.fortemi.index.chunk.v1` and contains the deterministic slice
for its manifest offset:

```json
{
  "schema_version": "aiwg.fortemi.index.chunk.v1",
  "manifest_schema_version": "aiwg.fortemi.index.chunk-manifest.v1",
  "offset": 0,
  "items": []
}
```

Vanilla hosts can validate and query this layout through the same controller:

```typescript
import {
  createAiwgFetchChunkLoader,
  createAiwgIndexController,
} from '@fortemi/core/aiwg-index'

const controller = createAiwgIndexController()
const manifest = await fetch('/search/aiwg-index/manifest.json').then((res) => res.json())

controller.loadChunkedIndex(
  manifest,
  createAiwgFetchChunkLoader('/search/aiwg-index/'),
  { maxCachedParts: 3 },
)

const page = await controller.queryChunked('', { offset: 1000, limit: 25 })
const ranked = await controller.queryChunked('deployment', {
  types: ['docs.page'],
  rank: true,
  snippets: true,
  limit: 10,
  onProgress: ({ done, total }) => console.log(`${done}/${total}`),
})
```

Unfiltered browse calls fetch only the part files intersecting `offset` and
`limit`. Filtered, full-text, and ranked calls scan part files to produce exact
totals, facets, ranking, snippets, and matches. The controller keeps a bounded
part cache and leaves `getIndex()` as `null`, so consumers do not hold the full
export in memory unless they explicitly use `loadIndex()`.

React apps can use `useAiwgIndex()` to load a full export, load a chunked
manifest through `loadChunkedIndex()`, search with `search()` or
`searchChunked()`, and maintain human-gated review decisions in local state.

Vanilla JavaScript hosts can use the framework-agnostic controller with the same
validation, query, graph projection, and review export behavior:

```typescript
import { createAiwgIndexController } from '@fortemi/core/aiwg-index'

const controller = createAiwgIndexController()
controller.loadIndex(exportJson)

const result = controller.query('tenant deployment', {
  types: ['docs.page'],
  rank: true,
  snippets: true,
  limit: 10,
})

for (const item of result.rankedItems ?? []) {
  console.log(item.item.title, item.snippet)
}
```

## Graph Projection

`useAiwgIndex()` also exposes `toCommunityGraph()`, which projects the loaded
AIWG export into graph nodes and edges suitable for `GraphView`. Nodes preserve
the source item id, title, type, tags, concepts, privacy classification, and PII
flag so reviewers can inspect CRM, task, and AIWG artifact relationships without
writing back to canonical AIWG data.

```tsx
import { useEffect, useMemo } from 'react'
import { GraphView, useAiwgIndex } from '@fortemi/react'

function AiwgReviewGraph({ exportJson }: { exportJson: unknown }) {
  const { index, loadIndex, toCommunityGraph } = useAiwgIndex()
  const graph = useMemo(() => (index ? toCommunityGraph() : null), [index, toCommunityGraph])

  useEffect(() => {
    loadIndex(exportJson)
  }, [exportJson, loadIndex])

  return <GraphView graph={graph} height={520} />
}
```

## Review Queues

Review decisions are exported separately as
`aiwg.fortemi.review-decisions.v1`. They are proposals only. Fortemi React does not
write canonical CRM JSON or trigger outreach.

## Fixture

`packages/core/test/fixtures/sanitized-aiwg-fortemi-index.json` mirrors the aiwg-crm
shared fixture and contains synthetic contact, organization, event, interaction, and
AIWG artifact records. Tests also cover `docs.page` records for static lookup
integration.
