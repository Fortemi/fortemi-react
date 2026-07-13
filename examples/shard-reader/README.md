# EX-08 · shard-reader

The Knowledge Shard **portability loop**, end to end:

1. A small database is seeded in this tab (PGlite).
2. `exportShard(db)` packs it into a single self-describing `.shard` — a tar.gz
   holding a manifest, component tables, and BLAKE3-hashed blob sidecars.
3. `useShard(bytes)` opens that archive **read-only, with no PGlite** — the
   reader is a pure archive query surface, so a viewer never ships the 8.7 MB
   Postgres engine.

```bash
pnpm install     # once, from the repo root
cd examples/shard-reader
pnpm dev
```

Click **Bake shard from this database** to run the export → open round-trip, or
**drop a `.shard`** exported from any other Fortémi instance — the reader half is
entirely independent of where the shard came from.

## What it shows

- `exportShard(db)` → the packed archive bytes.
- `useShard(source)` where `source` is `Uint8Array | Blob | { baseUrl }` — the
  PGlite-free reader (`manifest`, `listNotes`, `getNote`, plus `search`,
  `linksOf`, `conceptsOf`, `provenanceOf`, `semantic`).
- The shard manifest: format, creation time, component list, and per-component
  counts.

## Two halves, two dependency footprints

The **export** half needs the database, so this example mounts `FortemiProvider`
and pulls PGlite. The **reader** half does not: a shard *viewer* can import just
`@fortemi/react`'s `useShard` (or `@fortemi/core`'s `openShard`) and stay
engine-free. Split them in your own app to keep a read-only shard browser tiny.

## Copy it out

The app imports only `@fortemi/react`, `@fortemi/core` (for `exportShard`), and
`@fortemi/examples-shared` (seed data). The `vite.config.ts` uses the shared
`@fortemi/examples-shared/vite-db` PGlite wiring — needed for the export half;
inline it (or drop it, for a reader-only build) when you lift the example out.
