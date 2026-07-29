<div align="center">

# fortemi-react

**The browser edition of the Fortémi intelligent-database stack — profile-scoped interchange, client-side, local-first, private by default.**

Run the Fortémi schema entirely in the browser: real PostgreSQL (PGlite +
pgvector), typed React 19 hooks, and profile-scoped Knowledge Shard archives.
Build notebooks, research tools, and AI-powered knowledge apps where the data
lives on the user's device, search runs locally, and any cloud or AI provider is
opt-in and yours to choose — no backend, no account, no lock-in.

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
[![Built with aiwg](https://img.shields.io/npm/v/aiwg?label=built%20with%20aiwg&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/aiwg)

[**What Fortémi Is**](#what-fortémi-is) · [**Why**](#why-fortemi-react) · [**Get Started**](#quick-start) · [**Packages**](#packages) · [**Features**](#what-you-get) · [**AI Capabilities**](#ai-capabilities) · [**Documentation**](#documentation) · [**License**](#license)

</div>

---

## What Fortémi Is

Fortémi is an intelligent database for AI-ready applications: normalized data
contracts plus data-science and processing tooling that turn messy
organizational data into searchable, linkable, provenance-aware structures.
The Fortemi server owns the live APIs and Knowledge Shard authority;
`@fortemi/core` consumes the declared browser profiles, and HotM consumes the
server and Core contracts as an application. Receipt-bound profiles provide a
common interchange surface without implying one schema across every plane.

**fortemi-react is the browser edition of that stack.** It runs the normalized
schema in PGlite/pgvector with profile-scoped interchange — the browser
read/write/search core plus an opt-in, sandbox-limited slice of on-device
inference. Knowledge management is one use case built on the substrate, not the
whole product. What the browser edition uniquely adds: the data never has to
leave the device. Local-first and private-by-default stay the headline
differentiators.

### Fortémi (product) vs `@fortemi/core` (embeddable library)

`@fortemi/core` is an embeddable library — the headless data layer other tools build on. (For example, it is AIWG's default index and discovery backend, reading from a static local cache.) A tool that embeds `@fortemi/core` is **not running Fortémi**: it is using the library's schema and query surface inside its own process, and the library ships no data anywhere by default. Fortémi the product is the full stack — the server or this browser edition — with its job pipeline, capability system, and portable archives.

## Why fortemi-react

Most in-browser data stacks make you choose: capable but cloud-bound, or private but primitive. fortemi-react refuses the trade-off — it runs a full PostgreSQL engine *inside the browser*, so data never has to leave the device to be searchable, structured, and AI-ready.

- **Private by default.** Notes live in the browser on the user's device — no server, no sync service, no cloud backup, no account. The only thing that ever leaves the device is a cloud AI call you explicitly opt into.
- **Capable, not toy-grade.** Real PostgreSQL with `tsvector` full-text, pgvector HNSW semantic search, and BM25 reciprocal-rank fusion — production-grade retrieval that stays fast as an archive grows, entirely client-side.
- **AI on your terms.** Embeddings and LLMs are opt-in and bring-your-own: run locally (WebGPU, Ollama, LM Studio, llama.cpp, vLLM, Jan) or route to a provider you control. Nothing is wired to a vendor you can't swap out.
- **Yours to keep.** Knowledge Shard archives (tar.gz, with checksums and a
  declared portability profile) export the components supported by that
  profile on demand, and the AGPL-3.0 license keeps the stack open. No lock-in
  by design.

Use it when you need local-first note storage, semantic retrieval, agent-readable tool functions, or portable archives inside a web application — whether that's a personal notebook, a research workspace, or a product that must keep user data on the user's device.

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
| `@fortemi/graph` | npm | Framework-agnostic graph add-on: pure layout, filtering, coloring, degree sizing, bounds/fit, neighborhood, and snapshot helpers, plus a `GraphController` for graph-source selection. No React. Depends on `@fortemi/core`; consumed by `@fortemi/react` and JS-only hosts |
| `@fortemi/react` | npm | React 19 provider, hooks for notes, search, tags, collections, jobs, capabilities, shards, embedding sets, similarity graphs, and communities, plus 2D/3D graph views (`GraphView`, `SigmaGraphView`, `ForceGraph3DView`) |
| `@fortemi/standalone` | workspace app | Vite application for local development and static deployment |

All packages are versioned together — the npm badges above always show the current release.

## Contract Evidence

[Fortemi authority run 6393](https://git.integrolabs.net/Fortemi/fortemi/actions/runs/6393)
passed the same pinned authority-to-consumer contract on Linux x86_64, Linux
arm64, and macOS arm64. The matrix binds React/Core commit
`ccf96fad6025025293e40e250c85f088c8999d86` to
`@fortemi/core@2026.7.14` (tgz SHA-256
`e282f504a842261c3f598a7f2ee0d6a85e03dc213ddf545a18daf5f603a742cc`;
tar payload SHA-256
`47482320b543307c2d44f3a87a2268ead6faf265c6bd38cf33011e0ac7f8e77a`).

This evidence covers the declared Fortemi authority -> React/Core -> HotM
consumer surface and exact Knowledge Shard `2.0.0/full-v1` behavior on those
three platform cells. Windows remains deferred to
[Fortemi #1096](https://git.integrolabs.net/Fortemi/fortemi/issues/1096).
The suite audit in Fortemi #1081 remains `NO-GO`; this evidence does not prove
suite-wide portability, complete backup, every architecture, launched
GUI/native-dialog behavior, or one shared schema across the static-index,
state-transfer, and live-persistence planes.

## What You Get

- Full note CRUD with revision history, soft delete, starring, pinning, and archiving
- PGlite-backed local storage with `opfs`, `idb`, and `memory` persistence modes
- Writable canonical record tier that runs without PGlite — journaled IndexedDB records, Bytecask attachment bytes, DB-free shard import/export, and a rebuildable PGlite projection
- Full-text search with PostgreSQL `tsvector` / `tsquery`, phrase search, filters, facets, and snippets
- Hybrid semantic search with pgvector HNSW and BM25 reciprocal-rank fusion
- Virtual embedding-set selectors, cached similarity graphs, and graph/community artifact persistence
- Dynamic and user-authored communities with React graph-controller hooks for source switching
- Tags, collections, inter-note links, SKOS schemes, concepts, and relations
- Knowledge Shard tar.gz import/export with checksums, exact schema/profile
  negotiation, and receipt-backed component preservation
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
pnpm examples:site:build && pnpm examples:site:e2e   # built-gallery smoke test
```

The repository uses Node.js 22, pnpm 10, TypeScript, Vitest, Playwright, and Vite.

## Documentation

| Guide | Description |
|---|---|
| [Getting Started](docs/content/getting-started.md) | Installation, provider setup, first note, search |
| [Package Architecture](.aiwg/architecture/package-architecture.md) | Diagram and capability tables for each npm package and how they layer |
| [Search](docs/content/guides/search.md) | Text, semantic, and hybrid search modes, filters, RRF fusion, snippets |
| [Integration Guide](docs/content/guides/integration.md) | Embedding in React apps, tool helpers, events, jobs, capabilities |
| [API Reference](docs/content/api-reference.md) | Full API surface for `@fortemi/core`, `@fortemi/graph`, and `@fortemi/react` |
| [Deployment](docs/content/advanced/deployment.md) | Static hosting, Vite config, browser compatibility, WebGPU, CI/CD |
| [Extending](docs/content/advanced/extending.md) | Custom tools, job handlers, capabilities, migrations, hooks |
| [Supply Chain](docs/content/security/supply-chain.md) | Release signing, workflow pinning, and publishing controls |

## License

AGPL-3.0-only. See [LICENSE](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
