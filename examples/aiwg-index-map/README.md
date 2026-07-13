# EX-11 · aiwg-index-map

Project an **AIWG artifact index** — the JSON `aiwg index export` emits for an
AIWG-managed repo (agents, commands, rules, skills, docs) — into a
`CommunityGraph` and explore it with `GraphView`. The index is the graph source;
no database, no server, no downloads.

```bash
pnpm install      # once, from the repo root
cd examples/aiwg-index-map
pnpm dev
```

## What it shows

- **`useAiwgIndex(sampleIndex)`** holds a static `AiwgFortemiIndexExport` in
  memory. The hook itself is engine-free (the index is a plain object), so no
  `FortemiProvider` is mounted and nothing boots — the page is interactive
  immediately. The PGlite worker/WASM ship in `dist/` (the hook re-exports from
  the `@fortemi/react` root entry, which also carries `FortemiProvider`), but
  because no provider mounts they are **never fetched or compiled at runtime** —
  zero WASM download, instant load.
- **`toCommunityGraph()`** turns the index into a `CommunityGraph`:
  - nodes ← index items,
  - edges ← relationships whose target is also in the index (`uses`,
    `enforces`, `governed-by`, `documents`, `invoked-by`, `related`),
  - communities ← record **type** (`agent`, `command`, `rule`, `skill`, `doc`).
    The records carry no `concepts`, so the projection falls back to
    `type:<kind>` — the graph legend becomes the artifact taxonomy.
- **`search(query, { rank: true })`** runs the same lexical query AIWG's
  `discover` uses. Matched ids drive `GraphView`'s `filters={{ nodeIds }}` to
  spotlight hits without rebuilding the graph.
- **`counts`** gives exact per-type totals (the chips at the top).
- Selecting a node reads the full record from the index and lists its outbound
  relationships.

## Communities by type vs. by facet

The default community basis is `concepts` → `type` fallback. To group by
something else — say a `kind` facet or a `communityTagPrefix` — pass options:

```ts
toCommunityGraph({ communityFacet: 'type' })       // explicit facet grouping
toCommunityGraph({ communityTagPrefix: 'domain-' }) // group by domain-* tags
```

## Copying this out

Replace `src/index-fixture.ts` with a real export: run `aiwg index export`
against your AIWG-managed repo and load the JSON. For large indexes, use the
hook's **chunked** mode (`loadChunkedIndex` + `searchChunked` +
`toCommunityGraphChunked`) so the browser fetches only the manifest and the
parts a query touches. The rest of this example — projection, search-driven
filtering, per-type counts — is unchanged.

## Packages used

- [`@fortemi/react`](../../packages/react) — `useAiwgIndex`
- [`@fortemi/react/graph`](../../packages/react) — `GraphView`
- [`@fortemi/core/aiwg-index`](../../packages/core) — index types + projection
- [`@fortemi/graph`](../../packages/graph) — `CommunityGraph` (transitively)
