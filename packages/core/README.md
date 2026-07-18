<div align="center">

# @fortemi/core

**Headless browser knowledge-management core powered by PGlite, typed repositories, semantic retrieval, and agent tool helpers**

Build local-first knowledge apps where data stays in the browser on the user's device — no server, no account — with PostgreSQL-compatible storage, production-ready repositories, hybrid search primitives, portable Knowledge Shard archives, opt-in bring-your-own AI wiring, and bridge-ready tool metadata.

```bash
pnpm add @fortemi/core
```

[![npm version](https://img.shields.io/npm/v/@fortemi/core/latest?label=npm&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/core)
[![npm downloads](https://img.shields.io/npm/dm/@fortemi/core?color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/core)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Built with aiwg](https://img.shields.io/npm/v/aiwg?label=built%20with%20aiwg&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/aiwg)

[**Install**](#installation) · [**Why Fortemi**](#why-fortemi-core) · [**Quick Start**](#quick-start) · [**Surface**](#what-you-get) · [**Tools**](#tool-surface) · [**Docs**](#documentation) · [**License**](#license)

</div>

---

## What @fortemi/core Is

`@fortemi/core` is the headless Fortemi runtime for browser applications. It gives your app a durable local archive backed by PGlite, typed repository classes, migrations, eventing, capability management, Knowledge Shard import/export, and tool helpers that can be called from UI code or bridge adapters.

Use it when you want the browser to own the user's working knowledge: notes, links, tags, collections, SKOS concepts, attachments, search history, revisions, generated metadata, and portable exports. No application server is required for the core archive path, and the same package can power React, non-React, extension, or embedded host integrations.

## Why Fortemi Core

Most browser note and knowledge apps choose between a thin IndexedDB wrapper, a hosted database, or a custom sync protocol. Fortemi starts from a different premise: the browser can run a real PostgreSQL-compatible archive locally, then expose that archive through stable typed APIs and agent-readable tools.

| Need | What Fortemi provides |
|---|---|
| Local-first persistence | PGlite storage through OPFS, IndexedDB, or memory modes |
| Queryable knowledge | SQL-backed repositories for notes, links, tags, collections, SKOS concepts, jobs, and search |
| Retrieval quality | Full-text search, pgvector-backed semantic search, hybrid ranking, snippets, facets, and filters |
| AI-ready workflows | Optional embeddings, local LLM capability discovery, job provenance, and fallback routing |
| Portable archives | Knowledge Shard tar.gz import/export with set-scoped exports, chunked imports, checksums, BLAKE3-addressed blob sidecars, and profile-scoped conformance |
| Agent integration | Manifest-backed tools and direct helper functions for bridge adapters and automation |
| UI freedom | A headless package you can use from React, another framework, a browser extension, or a custom host |

### What You Can Build

- Local-first notebooks, research workspaces, and personal knowledge bases
- Browser-only semantic search over user-owned notes and imported knowledge
- AI memory layers for agents that need structured retrieval, provenance, and portable state
- Web apps that can run from static hosting while still offering durable local storage
- Import/export pipelines using Knowledge Shards instead of app-specific backup formats
- Custom React, Svelte, Vue, extension, or embedded UIs on top of the same archive model

### Architecture at a Glance

`ArchiveManager` opens a PGlite database, applies migrations, and scopes storage by archive name. Repository classes provide the canonical data-access layer. `TypedEventBus` keeps UI and background jobs in sync. Capability services track optional AI/runtime features. Tool helpers expose the same data model to bridges, local automations, and agent hosts.

## Installation

```bash
pnpm add @fortemi/core
# or
npm install @fortemi/core
```

Runtime dependencies installed with the package:

| Dependency | Purpose |
|---|---|
| `@electric-sql/pglite` | PostgreSQL compiled to WASM, plus pgvector |
| `@noble/hashes` | SHA hashing for content/integrity checks and BLAKE3 hashing for attachment blobs |
| `fflate` | Tar/gzip handling for Knowledge Shards |
| `uuid` | UUIDv7 identifiers |
| `zod` | Runtime input validation for tool helpers |

## Quick Start

```ts
import {
  ArchiveManager,
  NotesRepository,
  SearchRepository,
  TypedEventBus,
  registerServiceWorker,
} from '@fortemi/core'

const events = new TypedEventBus()
const archiveManager = new ArchiveManager('opfs', events)
const db = await archiveManager.open('default')

const notes = new NotesRepository(db, events)
const search = new SearchRepository(db)

const note = await notes.create({
  title: 'Hello',
  content: 'First note in the local archive.',
})

const results = await search.search('hello')

// Optional: register standalone service-worker routes.
await registerServiceWorker()
```

## Static AIWG Index Search

Static documentation hosts can import the AIWG index helpers without pulling in
PGlite, workers, shards, or browser storage:

```ts
import { createAiwgIndexController } from '@fortemi/core/aiwg-index'

const controller = createAiwgIndexController()
controller.loadIndex(await fetch('/aiwg-index.json').then((res) => res.json()))

const results = controller.query('deployment', {
  types: ['docs.page'],
  rank: true,
  snippets: true,
  limit: 10,
})
```

Use this subpath for Pagenary-style command palettes, static docs search, and
vanilla JavaScript review surfaces. The top-level `@fortemi/core` export remains
available for full archive/runtime integrations.

The AIWG index adapter accepts both `aiwg.fortemi.index.export.v1` and
`aiwg.fortemi.index.export.v2` envelopes. The v1 record contract keeps the
existing flat fields for filtering and search: `facets`, `tags`, `concepts`,
`relationships`, and `provenance`. Static consumers that render metadata tabs
can also read optional rich fields from full records:

- `skos_concepts`: concept ids plus labels, definitions, schemes, notation, URIs,
  alternate labels, and metadata.
- `skos_relations`: `broader`, `narrower`, `related`, or project-specific SKOS
  concept edges.
- `provenance_events`: W3C PROV-style activity records with agents, timestamps,
  source paths, confidence/privacy, and attributes.
- `relationships[*].metadata`: optional relationship labels, confidence,
  privacy, and structured metadata.

These fields are additive to `aiwg.fortemi.index.record.v1`. Version 2 records
can also carry AIWG migration fields such as `search`, `chunks`, `embeddings`,
`source.origin`, `source.generated`, `source.checksum`, `source.updated_at`,
`privacy.locality`, and compatibility metadata. Query helpers use v2 `search`
and `chunks` text when the old top-level `title`/`text` fields are absent.
Existing consumers can ignore the v2 fields and continue querying the flat
fields. Chunked indexes with a projection keep rich metadata in detail records;
call `getRecord(id)` before rendering a metadata panel.

Large static indexes can use the chunked browser path instead of downloading one
full `aiwg.fortemi.index.export.v1` file. Host a manifest plus deterministic part
files:

```text
/search/aiwg-index/manifest.json
/search/aiwg-index/part-0000.json
/search/aiwg-index/part-0001.json
```

```ts
import {
  createAiwgFetchChunkLoader,
  createAiwgIndexController,
} from '@fortemi/core/aiwg-index'

const controller = createAiwgIndexController()
const manifest = await fetch('/search/aiwg-index/manifest.json').then((res) => res.json())

controller.loadChunkedIndex(
  manifest,
  createAiwgFetchChunkLoader('/search/aiwg-index/'),
  { maxCachedParts: 3 },
)

const page = await controller.queryChunked('', { offset: 100, limit: 25 })
```

Unfiltered browse requests fetch only the part files intersecting the requested
`offset` and `limit`. Filtered or ranked searches scan part files to compute exact
results, but the controller keeps only a bounded part cache and never sets a
materialized full export in `getIndex()`.

AIWG records can use project-specific string types such as `aiwg.skill`,
`aiwg.agent`, `aiwg.command`, `aiwg.rule`, `aiwg.flow`, `aiwg.bundle`,
`aiwg.kb.page`, `aiwg.memory.entry`, `aiwg.issue`, `research.ref`, and
`aiwg.research.profile`. Validation still enforces required record fields, but
it does not require unknown AIWG, research, KB, memory, issue, or documentation
domains to collapse into `aiwg.artifact`.

For AIWG command-palette parity, opt into discovery ranking instead of the
default deterministic substring lookup:

```ts
const ranked = controller.query('address the open issues', {
  searchProfile: 'aiwg-discovery',
  rank: true,
  includeMatches: true,
})
```

The discovery profile normalizes hyphen/space variants, strips common stopwords,
boosts trigger and capability facets, and returns match reasons for UI debugging.

Chunked indexes also support graph navigation without loading a full export:

```ts
const neighbors = await controller.neighbors('aiwg:requirement:search', {
  direction: 'both',
  relationshipType: 'cites',
  relationshipDirection: 'downstream',
})

const graph = await controller.toCommunityGraphChunked()
```

Relationship edges preserve v2 `source_path`, `target_path`, and
`direction: 'upstream' | 'downstream' | 'related'` values. Use
`direction: 'in' | 'out' | 'both'` for graph orientation around a node and
`relationshipDirection` for AIWG dependency/citation/profile/KB direction
semantics. When scan parts are projected, relationship traversal scans the parts
and lazy-loads detail records only when relationships are not present in the
scan projection.

Static semantic search uses an optional sidecar contract:

```ts
import { buildAiwgStaticEmbeddingSet, queryAiwgHybridIndex } from '@fortemi/core/aiwg-index'

const embeddingSet = await fetch('/search/aiwg-index/embeddings.json').then((res) => res.json())
const queryEmbedding = await hostEmbed('workspace health check')
const semanticResults = queryAiwgHybridIndex(index, embeddingSet, 'health check', queryEmbedding)

// Node/CLI generation path. Supply any Node-safe model backend; @fortemi/core
// only writes the shared embedding-set graph format and does not require DOM or WebGL.
const cliEmbeddingSet = await buildAiwgStaticEmbeddingSet(index, {
  id: 'aiwg-cli-embeddings',
  backend: {
    model: 'local-node-embedder',
    dimensions: 384,
    embed: async (input) => nodeEmbed(input),
  },
})
```

`aiwg.fortemi.embedding.set.v1` records the model, dimensions, granularity
(`title-summary`, `body`, `chunked-body`, or a project value), source record IDs,
and per-vector input hashes. Hosts provide query embeddings; `@fortemi/core` does
not add a model runtime dependency for static AIWG search. The builder uses the
same record text projection as static search, including attachment
`extracted_text`, and records only attachment metadata references, never raw blob
bytes.

## What You Get

| Surface | Description |
|---|---|
| PGlite archive | `opfs`, `idb`, and `memory` persistence modes with migrations on open |
| Repositories | Notes, search, tags, collections, links, SKOS concepts, attachments, embedding sets, graph helpers, jobs, and provenance |
| Event bus | Typed subscriptions for note, job, archive, and capability events |
| Capability system | Embeddings, local LLM, GPU detection, local-provider discovery, fallback routing |
| Job queue | Server-compatible background workflow for revisions, titles, embeddings, concepts, and links |
| Knowledge Shards | Tar.gz import/export with checksums, BLAKE3-addressed blob sidecars, progress callbacks, yielding imports, set-scoped embedding exports, and profile-scoped conformance |
| Service-worker helpers | Route registration primitives for standalone browser integration |

## Search and Knowledge Model

Fortemi's archive is more than note CRUD. The schema includes note bodies, generated titles, revision history, tags, collections, inter-note links, SKOS concept schemes, attachments, job provenance, and query history. Search can combine PostgreSQL full-text ranking with pgvector embeddings, then fuse scores for hybrid results.

That gives product teams a foundation for features users already expect from serious knowledge software: fast recall, related-note discovery, semantic retrieval, explainable provenance, import/export, and structured taxonomy support.

## Tool Surface

`FortemiToolManifest` registers 10 bridge-visible Fortemi tools:

`capture_knowledge`, `manage_note`, `search`, `get_note`, `list_notes`, `manage_tags`, `manage_collections`, `manage_links`, `manage_archive`, `manage_capabilities`.

The package also exports 11 direct helper functions from `@fortemi/core`, including `manageAttachments` for attachment metadata and blob operations.

```ts
import { fortemiManifest } from '@fortemi/core'

const capabilities = fortemiManifest.toBridgeCapabilities()
```

Use the manifest when a host needs to advertise Fortemi operations to an agent runtime. Use the direct helper functions when your own code needs the same validated operations without going through a bridge layer.

## Browser Storage

| Mode | Storage | Best for |
|---|---|---|
| `opfs` | Origin Private File System access-handle pool | Chrome and Edge production apps |
| `idb` | IndexedDB-backed PGlite data directory | Firefox and broad compatibility |
| `memory` | In-memory database | Tests, demos, restricted browser contexts |

Data stays in the selected browser storage mode unless your application explicitly exports it, imports it, or wires external providers. Optional AI capabilities are opt-in and can be routed to local WASM, local provider servers, OpenAI-compatible APIs, or host-provided integrations depending on your product requirements. API keys should live only in browser or machine secure storage; if secure storage is unavailable, do not persist them.

## React Bindings

For React applications, install `@fortemi/react`. It wraps `@fortemi/core` with `FortemiProvider`, context access, worker-mode PGlite, graph visualization primitives, and the React hook surface.

```bash
pnpm add @fortemi/react @fortemi/core react
```

## Documentation

- [Repository API](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/api-reference.md#repositories)
- [Integration guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/guides/integration.md)
- [Search guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/guides/search.md)
- [Extending Fortemi](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/advanced/extending.md)
- [Supply-chain controls](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/security/supply-chain.md)

## License

AGPL-3.0-only. See [LICENSE](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
