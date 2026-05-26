<div align="center">

# @fortemi/core

**Headless browser knowledge-management core powered by PGlite, typed repositories, semantic retrieval, and agent tool helpers**

Build local-first knowledge apps with PostgreSQL-compatible storage in the browser, production-ready repositories, search primitives, Knowledge Shard portability, optional local AI wiring, and bridge-ready tool metadata.

```bash
pnpm add @fortemi/core
```

[![npm version](https://img.shields.io/npm/v/@fortemi/core/latest?label=npm&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/core)
[![npm downloads](https://img.shields.io/npm/dm/@fortemi/core?color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/core)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

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
| Portable archives | Knowledge Shard tar.gz import/export with checksums and JSON format parity |
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
| `@noble/hashes` | SHA hashing for content and integrity checks |
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

## What You Get

| Surface | Description |
|---|---|
| PGlite archive | `opfs`, `idb`, and `memory` persistence modes with migrations on open |
| Repositories | Notes, search, tags, collections, links, SKOS concepts, attachments, embedding sets, graph helpers, jobs, and provenance |
| Event bus | Typed subscriptions for note, job, archive, and capability events |
| Capability system | Embeddings, local LLM, GPU detection, local-provider discovery, fallback routing |
| Job queue | Server-compatible background workflow for revisions, titles, embeddings, concepts, and links |
| Knowledge Shards | Tar.gz import/export with checksums and JSON format parity |
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

Data stays in the selected browser storage mode unless your application explicitly exports it, imports it, or wires external providers. Optional AI capabilities are opt-in and can be routed to local WASM, local provider servers, or host-provided integrations depending on your product requirements.

## React Bindings

For React applications, install `@fortemi/react`. It wraps `@fortemi/core` with `FortemiProvider`, context access, and 21 hooks.

```bash
pnpm add @fortemi/react @fortemi/core react
```

## Documentation

- [Repository API](https://github.com/Fortemi/fortemi-react/blob/main/docs/api-reference.md#repositories)
- [Integration guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/integration.md)
- [Search guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/search.md)
- [Extending Fortemi](https://github.com/Fortemi/fortemi-react/blob/main/docs/extending.md)
- [Supply-chain controls](https://github.com/Fortemi/fortemi-react/blob/main/docs/security/supply-chain.md)

## License

AGPL-3.0-only. See [LICENSE](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
