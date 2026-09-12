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

The supplemental native operation fixture qualifies published Core2026.9.4
against native Linux AMD64 server2026.9.9 for required personal identity, FTS
search and all advertised note mutations. Current tests replay that capture;
they do not contact your server or establish a newer published version.
Semantic/hybrid fallback is not positive vector retrieval, and personal
authentication does not qualify hosted tenant/role enforcement. Producer
`36c1b877` owns the receipt; see the Core fixture README. Suite NO-GO remains.

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
  `provenanceOf` is unsupported. Search defaults to FTS with `q`; its timestamps
  require detail enrichment. The API exposes degradation and a report-bearing
  semantic method. REST note mutations use explicit validated action mappings;
  source fixture tests do not establish live released-package qualification.
- No `FortemiProvider` is mounted — `useRemote` needs no local database. (The
  `@fortemi/react` root entry still carries the engine, so it ships in `dist/`
  but never boots.)

## Local vs. remote

Producer-captured fixture tests are not published-package/live-server acceptance.
Errors preserve bounded HTTP status and problem codes without exposing response
content. A failed relationship request does not turn an existing note into null.

The supplemental native fixture records a historical published Core 2026.9.4
run against published Linux AMD64 server 2026.9.9 with required API identity.
Current tests replay those bytes offline; they do not contact your server.
Personal-mode authenticated note reads use AllowAllPolicy. The captured operator
403 is not proof of note-scope denial; its note-method test is explicitly
transport injection. Hosted authorization and inference remain unqualified.
See the [fixture boundaries](../../packages/core/src/__tests__/fixtures/README.md).

Producer-owned negative controls additionally cover malformed responses,
socket failures and failed enrichment. The historical published-package check
used private loopback fault injection; current source tests replay it offline.
Only recognized note-not-found404 becomes null. Missing/invalid credentials were
denied with401 by the real personal-mode server; this does not prove hosted or
authenticated role/tenant403 enforcement. Full-detail enrichment failures reject
the request rather than return a partial note.

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
