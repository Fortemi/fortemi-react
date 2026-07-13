# EX-06 · notes-crud-minimal

The whole in-browser knowledge store in one screen: create, list, edit, and
soft-delete notes — backed by **PGlite (Postgres compiled to WASM)** running
inside the tab. No server, no network, no ORM. The data layer is the same one
the Fortémi app ships.

```bash
pnpm install     # once, from the repo root
cd examples/notes-crud-minimal
pnpm dev
```

## What it shows

- `FortemiProvider` owning the database (`persistence="memory"` — instant and
  disposable; switch to `"idb"` on Firefox or `"opfs"` on Chrome to persist).
- The CRUD hooks: `useNotes` (paginated list), `useCreateNote`, `useUpdateNote`,
  `useDeleteNote` — a complete note lifecycle.
- Soft-delete semantics: `deleteNote` sets `deleted_at`; nothing is ever
  hard-removed.
- A one-time seed from `@fortemi/examples-shared` so the list isn't blank on
  first load.

## Copy it out

The **app** imports only `@fortemi/react` and `@fortemi/examples-shared` — swap
the seed import for your own content and it runs anywhere. The **`vite.config.ts`**
uses the shared `@fortemi/examples-shared/vite-db` helper for the PGlite/worker
wiring; when you lift this into your own project, inline those `worker`,
`optimizeDeps`, and COOP/COEP header blocks (they're documented in that file).

PGlite needs cross-origin isolation (`SharedArrayBuffer`), so serve the built
app with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` — the config sets these for
`vite dev`/`preview` already.
