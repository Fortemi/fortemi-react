<div align="center">

# @fortemi/core

**Headless browser knowledge-management core powered by PGlite, typed repositories, and agent tool helpers**

Local PostgreSQL-compatible storage, migrations, note/search repositories, capability orchestration, Knowledge Shards, and bridge-ready tool metadata for browser applications.

```bash
pnpm add @fortemi/core
```

[![npm version](https://img.shields.io/npm/v/@fortemi/core/latest?label=npm&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/core)
[![npm downloads](https://img.shields.io/npm/dm/@fortemi/core?color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/core)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

[**Install**](#installation) · [**Quick Start**](#quick-start) · [**Surface**](#what-you-get) · [**Tools**](#tool-surface) · [**Docs**](#documentation) · [**License**](#license)

</div>

---

## What @fortemi/core Is

`@fortemi/core` is the headless Fortemi runtime for browser applications. It provides a PGlite-backed archive, repository classes, migrations, eventing, capability management, Knowledge Shard import/export, and tool helpers that can be called from UI code or bridge adapters.

Use `@fortemi/core` directly when you are building your own UI, integrating Fortemi into a non-React host, or wiring agent/tool calls against an existing browser database context.

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
| Repositories | Notes, search, tags, collections, links, SKOS concepts, and attachments |
| Event bus | Typed subscriptions for note, job, archive, and capability events |
| Capability system | Embeddings, local LLM, GPU detection, local-provider discovery, fallback routing |
| Job queue | Server-compatible background workflow for revisions, titles, embeddings, concepts, and links |
| Knowledge Shards | Tar.gz import/export with checksums and JSON format parity |
| Service-worker helpers | Route registration primitives for standalone browser integration |

## Tool Surface

`FortemiToolManifest` registers 10 bridge-visible Mnemos tools:

`capture_knowledge`, `manage_note`, `search`, `get_note`, `list_notes`, `manage_tags`, `manage_collections`, `manage_links`, `manage_archive`, `manage_capabilities`.

The package also exports 11 direct helper functions from `@fortemi/core`, including `manageAttachments` for attachment metadata and blob operations.

```ts
import { fortemiManifest } from '@fortemi/core'

const capabilities = fortemiManifest.toPlinyCapabilities()
```

## Browser Storage

| Mode | Storage | Best for |
|---|---|---|
| `opfs` | Origin Private File System access-handle pool | Chrome and Edge production apps |
| `idb` | IndexedDB-backed PGlite data directory | Firefox and broad compatibility |
| `memory` | In-memory database | Tests, demos, restricted browser contexts |

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
