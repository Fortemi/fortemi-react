# EX-19 · dual-instance-sync

Two in-browser instances start with **divergent** notes and converge by
exchanging shards **both ways**. There is no server and no sync protocol — a
bidirectional shard swap (export A → import B, export B → import A, with the
`skip` conflict strategy) merges each side's set into the union. It's
idempotent: run it twice and nothing changes, so the two databases are
eventually consistent.

```bash
pnpm install     # once, from the repo root
cd examples/dual-instance-sync
pnpm dev
```

Click **Sync A ↔ B**; both counts rise to the union and the app marks it
converged. Click **Sync again** — nothing changes.

## What it shows

- Two `FortemiProvider`s (distinct `archiveName`s) → two independent databases.
- Each `Instance` exposes an imperative sync handle (`exportBytes` / `importBytes`
  / `refresh`) up to the parent, so one button drives the bidirectional exchange.
- `exportShard(db)` + `useImportShard().importShard(file, 'skip')` as the sync
  primitive; `skip` makes the merge idempotent.

This is the shard-as-sync-transport idea (EX-08, EX-13) taken to convergence. In
a real deployment the two instances live on different devices and swap the
`.shard` over any channel — email, a USB stick, an object store.

## Copy it out

The app imports only `@fortemi/react`, `@fortemi/core` (`exportShard`), and
`@fortemi/examples-shared`. It's a database example, so `vite.config.ts` uses the
shared `@fortemi/examples-shared/vite-db` PGlite wiring — inline it when you lift
the example out.
