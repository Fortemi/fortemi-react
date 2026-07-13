# EX-16 · knowledge-garden

A composed application: the starters, wired into one workspace over a single
in-browser **PGlite** database. Search filters the note list *and* spotlights
matches in a tag-derived graph; selecting a note anywhere — list, graph, or a
search hit — drives one shared detail pane; create and delete mutate the same
store the graph is built from. No server, no downloads.

```bash
pnpm install     # once, from the repo root
cd examples/knowledge-garden
pnpm dev
```

## What it composes

- **Data:** `useNotes` / `useCreateNote` / `useDeleteNote` / `useNote` — the CRUD
  surface and the click-to-load detail.
- **Search:** `useSearch` (`mode: 'text'`) drives both the list filter and the
  graph spotlight (matched ids become the `GraphView` `nodeIds` allow-list).
- **Graph:** a `CommunityGraph` derived from note tags, rendered with the
  PGlite-free `GraphView`, sharing the app's single `selected` node.

One selection, three views, one database. This is the pattern for building a real
Fortémi surface: compose the focused hooks rather than reaching for a monolith.

## Copy it out

The app imports only `@fortemi/react`, `@fortemi/react/graph`, and
`@fortemi/graph`; the seed corpus is a local `corpus.ts`. It's a database
example, so `vite.config.ts` uses the shared `@fortemi/examples-shared/vite-db`
PGlite wiring — inline it when you lift the example out.
