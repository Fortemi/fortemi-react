# EX-13 · shard-exchange

Two independent Fortémi instances in **one page** — each with its own PGlite
database, keyed by a distinct `archiveName`. Instance A seeds notes and exports a
Knowledge Shard; instance B imports those bytes with a conflict strategy. The
shard *is* the sync transport: export here, import there, no server between.

```bash
pnpm install     # once, from the repo root
cd examples/shard-exchange
pnpm dev
```

Click **Export shard →** on A, pick a conflict strategy on B, then
**← Import shard**. B fills with A's notes and reports the per-component import
counts.

## What it shows

- Two `FortemiProvider`s side by side with different `archiveName`s → two
  separate in-memory databases in the same tab.
- `exportShard(db)` on the source, `useImportShard().importShard(file, strategy)`
  on the target (the bytes are handed over in-memory and wrapped in a `File`).
- Conflict strategies (`skip` / `replace` / `error`) and the `ImportResult`
  counts + warnings.

## Copy it out

The app imports only `@fortemi/react`, `@fortemi/core` (for `exportShard` +
`ConflictStrategy`/`ImportResult` types), and `@fortemi/examples-shared`. It's a
database example, so `vite.config.ts` uses the shared
`@fortemi/examples-shared/vite-db` PGlite wiring — inline it when you lift the
example out. In a real deployment the two instances live in different
browsers/machines and exchange the `.shard` as a file or over any transport.
