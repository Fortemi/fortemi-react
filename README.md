<div align="center">

# fortemi-react

**Browser-only knowledge management packages for React, PGlite, semantic search, and agent tool integration**

Full PostgreSQL in the browser with PGlite WASM, typed React 19 hooks, SKOS tagging, Knowledge Shard import/export, local AI capability wiring, and JSON format parity with the Fortemi server.

```bash
pnpm add @fortemi/core @fortemi/react
pnpm dev
```

[![core npm version](https://img.shields.io/npm/v/@fortemi/core/latest?label=@fortemi/core&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/core)
[![react npm version](https://img.shields.io/npm/v/@fortemi/react/latest?label=@fortemi/react&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/react)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

[**Get Started**](#quick-start) · [**Packages**](#packages) · [**Features**](#what-you-get) · [**AI Capabilities**](#ai-capabilities) · [**Documentation**](#documentation) · [**License**](#license)

</div>

---

## What fortemi-react Is

fortemi-react is a browser-only knowledge management toolkit. It gives React applications a local PostgreSQL-compatible archive using PGlite, repository APIs for notes and knowledge structures, optional local AI capability wiring, and typed hooks for building production UI without a server.

Use it when you need local-first note storage, semantic retrieval, agent-readable tool functions, or portable Knowledge Shard archives inside a web application.

## Quick Start

Install the published packages:

```bash
pnpm add @fortemi/core @fortemi/react
# or
npm install @fortemi/core @fortemi/react
```

Run the standalone app from this repository:

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Minimal React setup:

```tsx
import { FortemiProvider, useCreateNote, useSearch } from '@fortemi/react'

export function App() {
  return (
    <FortemiProvider persistence="opfs" archiveName="default">
      <Notebook />
    </FortemiProvider>
  )
}

function Notebook() {
  const { createNote } = useCreateNote()
  const { data, search } = useSearch()

  return (
    <main>
      <button onClick={() => void createNote({ title: 'Hello', content: 'First note.' })}>
        Add note
      </button>
      <input onChange={(event) => void search(event.target.value)} />
      <ul>
        {data?.items.map((item) => <li key={item.id}>{item.title}</li>)}
      </ul>
    </main>
  )
}
```

## Packages

| Package | Published | Purpose |
|---|---|---|
| `@fortemi/core` | npm | Headless data layer: PGlite repositories, migrations, workers, tool helpers, event bus, capability system |
| `@fortemi/react` | npm | React 19 provider and hooks for notes, search, tags, collections, jobs, capabilities, and shards |
| `@fortemi/standalone` | workspace app | Vite application for local development and static deployment |

All packages are versioned together. The current release is `2026.5.3`.

## What You Get

- Full note CRUD with revision history, soft delete, starring, pinning, and archiving
- PGlite-backed local storage with `opfs`, `idb`, and `memory` persistence modes
- Full-text search with PostgreSQL `tsvector` / `tsquery`, phrase search, filters, facets, and snippets
- Hybrid semantic search with pgvector HNSW and BM25 reciprocal-rank fusion
- Tags, collections, inter-note links, SKOS schemes, concepts, and relations
- Knowledge Shard tar.gz import/export with checksums and JSON format parity
- 10 manifest-backed Fortemi tools plus 11 exported direct tool helper functions
- Optional embeddings, LLM, local-provider discovery, WebGPU detection, and fallback routing
- React 19 hooks for common UI workflows and direct context access for lower-level integration

## Runtime Support

| Runtime | Storage | AI capability notes |
|---|---|---|
| Chrome 113+ / Edge 113+ | OPFS recommended | WebGPU available when enabled; Linux Chrome may require flags |
| Firefox 111+ | IndexedDB fallback | WASM embeddings work; WebGPU production support is limited |
| Safari 17+ | Memory or IndexedDB depending context | Use `memory` for previews and tests when persistence is restricted |

No backend is required. Deploy `apps/standalone/dist/` to any static host.

## AI Capabilities

fortemi-react supports opt-in capabilities through the runtime capability manager:

| Capability | Runtime | Enables |
|---|---|---|
| Semantic embeddings | transformers.js WASM | Hybrid search, related notes, link discovery |
| Local LLM | WebLLM / compatible provider | AI revision, concept tagging, title generation |
| GPU detection | WebGPU adapter probing | Hardware tier and model-fit guidance |
| Local provider discovery | Ollama, LM Studio, llama.cpp, vLLM, Jan | Remote/local provider fallback routing |

On Linux Chrome, local WebGPU inference commonly needs:

```bash
google-chrome --enable-features=Vulkan --enable-unsafe-webgpu http://localhost:5173
```

## Tool Integration

`@fortemi/core` exports `fortemiManifest` for bridge registration and direct helper functions for application code. The manifest currently includes:

`capture_knowledge`, `manage_note`, `search`, `get_note`, `list_notes`, `manage_tags`, `manage_collections`, `manage_links`, `manage_archive`, `manage_capabilities`.

Direct helper exports also include `manageAttachments` for attachment metadata and blob operations.

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test:core
pnpm test:e2e
pnpm build
```

The repository uses Node.js 22, pnpm 10, TypeScript, Vitest, Playwright, and Vite.

## Documentation

| Guide | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | Installation, provider setup, first note, search |
| [Search](docs/search.md) | Text, semantic, and hybrid search modes, filters, RRF fusion, snippets |
| [Integration Guide](docs/integration.md) | Embedding in React apps, tool helpers, events, jobs, capabilities |
| [API Reference](docs/api-reference.md) | Full API surface for `@fortemi/core` and `@fortemi/react` |
| [Deployment](docs/deployment.md) | Static hosting, Vite config, browser compatibility, WebGPU, CI/CD |
| [Extending](docs/extending.md) | Custom tools, job handlers, capabilities, migrations, hooks |
| [Supply Chain](docs/security/supply-chain.md) | Release signing, workflow pinning, and publishing controls |

## License

AGPL-3.0-only. See [LICENSE](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
