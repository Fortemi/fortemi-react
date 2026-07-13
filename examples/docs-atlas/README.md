# EX-17 · docs-atlas

A **deployable, database-free knowledge map**. A build step reads a markdown
corpus, derives a tag-similarity graph, and bakes the layout into a static
snapshot. The runtime loads it PGlite-free, renders the baked coordinates with
no layout pass, and opens a doc when you click a node — the docs.fortemi.com
pattern generalized to any static host.

```bash
pnpm install      # once, from the repo root
cd examples/docs-atlas
pnpm dev          # bakes the atlas, then serves it
```

## Two stages

**Build time** — `scripts/build-atlas.mjs` (Node, runs on `predev`/`prebuild`):

1. Read `corpus/*.md`, parse frontmatter (`title`, `tags`) and render the body
   to HTML with a tiny dependency-free renderer.
2. Build a `CommunityGraph`: nodes are docs, edges are shared-tag counts,
   communities are the first tag.
3. `bakeRenderGraph(graph, { palette: 'community', layout, labelFor })` lays it
   out once and `stringifyRenderGraph` writes `public/atlas-snapshot.json`
   (nodes carrying baked `x`/`y`), alongside `public/atlas-docs.json` for the
   reader.

The only build dependency is `@fortemi/graph`.

**Runtime** — `src/App.tsx`:

- `loadRenderSnapshot(url)` returns the baked `RenderGraph` (or `null`, never
  throwing, if the snapshot is missing). The SVG draws `node.x`/`node.y`
  directly — **there is no runtime layout**, so the map appears instantly.
- The reader renders the doc HTML; internal `[link](doc-id)` clicks navigate the
  atlas instead of scrolling.
- No `FortemiProvider`, no PGlite, no model download. `vite.config.ts` stubs
  `@fortemi/core` so the ~9 MB engine stays out of the static build.

## Why bake?

Layout is the expensive part. Doing it once at build time means the deployed
bundle is a few KB of coordinates that render the same on every load — no
force-simulation jank, no per-visitor CPU. Re-run `pnpm atlas` whenever the
corpus changes.

## Copying this out

Point `corpus/` at your own markdown (docs, notes, a wiki export). Swap the
tag-similarity edges for `useSimilarityGraph` output baked the same way if you
want embedding-based structure. The runtime — snapshot load, baked render,
reader — is unchanged.

## Packages used

- [`@fortemi/graph`](../../packages/graph) — `bakeRenderGraph`,
  `stringifyRenderGraph`, `loadRenderSnapshot`, `hasBakedPositions`, `RenderGraph`
