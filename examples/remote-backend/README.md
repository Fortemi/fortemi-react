# EX-14 · remote-backend

The **local/remote seam**. EX-06 (`notes-crud-minimal`) and EX-07
(`search-basic`) build a note list and search over the in-browser PGlite
database. This example is the same UI shape, but every read goes to a Fortémi
**server** through `useRemote` — swap the backend, keep the surface.

```bash
pnpm install      # once, from the repo root
cd examples/remote-backend
pnpm dev
```

## Requires a running server

Unlike the other examples, this one needs a **Fortémi server** to return data.
Enter its URL (default `http://localhost:3000`) and an optional bearer token,
then **Load notes**. With no server reachable the calls surface a clear error —
the demo still compiles and renders; it just has nothing to list.

## What it shows

- **`useRemote(config)`** creates a REST-backed `DataBackend` and exposes the
  same operations the local hooks do: `listNotes`, `search`, `getNoteFull`,
  plus `linksOf` / `conceptsOf` / `provenanceGraphOf`. `config` is just
  `{ baseUrl, authToken? }` (and optional custom `paths` / `fetchImpl` /
  `headers`).
- List and detail use validated server envelopes. The provenance graph retains
  server activities and edges; it is not a local PGlite edge list. Remote
  `provenanceOf` is unsupported. Search mapping (#419) and mutation/capability
  dispatch (#420) remain open repairs, not qualified operations in this example.
- No `FortemiProvider` is mounted — `useRemote` needs no local database. (The
  `@fortemi/react` root entry still carries the engine, so it ships in `dist/`
  but never boots.)

## Local vs. remote

Producer-captured fixture tests are not published-package/live-server acceptance.
Errors preserve bounded HTTP status and problem codes without exposing response
content. A failed relationship request does not turn an existing note into null.

| | Local (EX-06/07) | Remote (this) |
|---|---|---|
| Backend | PGlite in the tab | Fortémi server |
| Setup | `FortemiProvider` | `useRemote({ baseUrl })` |
| Data | disposable, in-memory | shared, server-owned |
| Offline | yes | no (needs the server) |

## Packages used

- [`@fortemi/react`](../../packages/react) — `useRemote`
- [`@fortemi/core`](../../packages/core) — `RemoteBackendConfig`, `BackendNote`,
  `BackendNoteFull`, `BackendSearchHit`, `DataBackend`
