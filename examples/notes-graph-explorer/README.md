# EX-10 · notes-graph-explorer

Where the data layer meets the graph stack. Real notes live in **PGlite**; this
example derives a `CommunityGraph` from their **tags** — notes that share tags
are linked, each note's first tag is its community — and explores it with the
PGlite-free `GraphView`. Click a node to pull the full note back from the
database. No embeddings, no downloads; the structure is pure tag overlap.

```bash
pnpm install     # once, from the repo root
cd examples/notes-graph-explorer
pnpm dev
```

## What it shows

- Deriving graph structure from database content: `useNotes` → a `CommunityGraph`
  built from tag co-occurrence (`buildTagGraph`).
- `GraphView` over that derived graph with the shared filter contract
  (`minDegree`) and `communityLegend` for the per-community swatches.
- Click-to-load: `useNote(selectedId)` fetches the full record (`.current.content`)
  on selection.

Swap the tag-overlap heuristic for `useSimilarityGraph` (embedding cosine) or
`useCommunities` (stored assignments) when you want semantic or curated
structure instead — the render half stays identical.

## Copy it out

The app imports only `@fortemi/react`, `@fortemi/react/graph`, `@fortemi/graph`,
and `@fortemi/examples-shared`. It's a database example, so `vite.config.ts` uses
the shared `@fortemi/examples-shared/vite-db` PGlite wiring — inline it when you
lift the example out.
