# EX-02 · graph-view-static

**Category:** Graph · React · no database
**Packages:** `@fortemi/react/graph`, `@fortemi/graph`

The PGlite-free React graph view. `GraphView` (from the `@fortemi/react/graph`
subpath) renders a `CommunityGraph` as SVG with layout, selection, hover labels,
and the shared filter contract — and carries **no runtime dependency on the
database**.

## What it teaches

- `GraphView` takes a `CommunityGraph` directly and lays it out for you.
- Controlled selection (`selectedNodeId` + `onSelectNode`) and `labelFor`.
- The shared filter contract (`GraphControlFilters`): `minDegree` and
  `communityIds` (an allow-list) drive live show/hide.
- `communityLegend(graph)` supplies the legend rows and their colors.
- The `@fortemi/react/graph` subpath keeps PGlite out of your bundle; the
  database-backed controller lives behind `@fortemi/graph/controller`.

## APIs used

| API | From |
|-----|------|
| `GraphView`, `GraphViewFilters` | `@fortemi/react/graph` |
| `communityLegend` | `@fortemi/graph` |

## Run it

```bash
pnpm install   # from the repo root, once
pnpm dev       # from this directory
```
