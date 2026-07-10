<div align="center">

# @fortemi/react

**React 19 provider and hooks for local-first Fortemi knowledge archives**

Build React knowledge apps that keep user data in the browser on the device — private by default, no backend required — with browser-local PostgreSQL storage, typed hooks, hybrid search, SKOS concepts, job queues, bring-your-own AI providers, graph views, and Knowledge Shard import/export.

```bash
pnpm add @fortemi/react @fortemi/core react
```

[![npm version](https://img.shields.io/npm/v/@fortemi/react/latest?label=npm&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/react)
[![npm downloads](https://img.shields.io/npm/dm/@fortemi/react?color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/react)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Built with aiwg](https://img.shields.io/npm/v/aiwg?label=built%20with%20aiwg&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/aiwg)

[**Install**](#installation) · [**Why Fortemi**](#why-fortemi-react) · [**Quick Start**](#quick-start) · [**Hooks**](#hooks) · [**Provider**](#provider) · [**Docs**](#documentation) · [**License**](#license)

</div>

---

## What @fortemi/react Is

`@fortemi/react` is the React integration layer for `@fortemi/core`. It initializes the local Fortemi archive, exposes runtime services through context, and provides hooks for common knowledge-management UI workflows.

Use it when you want a React 19 application to ship serious local knowledge management without first building database plumbing, repository classes, search orchestration, background jobs, or capability wiring. The package wraps Fortemi's browser-local PGlite archive so your UI can focus on notes, search, tags, collections, links, concepts, imports, exports, and AI-assisted workflows.

## Why Fortemi React

Fortemi React is for product teams that want the user experience of a modern knowledge app without requiring a hosted backend for the archive itself. It gives React components direct access to a local PostgreSQL-compatible database through ergonomic hooks, while still preserving lower-level escape hatches for custom integrations.

| Product need | React package support |
|---|---|
| Local-first user data | `FortemiProvider` opens OPFS, IndexedDB, or memory-backed PGlite archives on the main thread or in worker mode |
| Fast note UI | Hooks for note CRUD, lists, single-note reads, deletion, and automatic refresh |
| Search UX | Full-text, semantic, and hybrid search hooks with history and suggestions |
| Knowledge organization | Tags, collections, links, SKOS concepts, related notes, and provenance hooks |
| AI workflows | Job queue, embeddings, capability setup, GPU detection, local-provider discovery, and OpenAI-compatible provider configuration |
| Portability | Knowledge Shard import/export hooks with chunked import progress and scoped embedding export |
| Graph review | `GraphView` plus AIWG index graph projection for visual inspection workflows |
| Advanced integration | Direct context access to the database, event bus, archive manager, capability manager, and blob store |

### What You Can Build

- Local-first notebooks, research tools, and personal knowledge bases
- Semantic search interfaces that work against user-owned browser storage
- Agent memory panels with retrieval, provenance, and tool-callable operations
- Static-hosted web apps that still offer durable local persistence
- Import/export workflows using Fortemi Knowledge Shards
- Custom product UIs backed by the same headless core used by non-React integrations

### Core Value, Rolled Up

You do not need to read the core package first to understand the value: `@fortemi/react` brings Fortemi's PGlite archive, migrations, repository model, hybrid retrieval, Knowledge Shards, capability manager, event bus, and bridge-compatible tool surface into React context. Use hooks for the common paths, and drop to `useFortemiContext()` when you need raw access.

## Installation

```bash
pnpm add @fortemi/react @fortemi/core react
# or
npm install @fortemi/react @fortemi/core react
```

`react` is a peer dependency (`^19.0.0`). `@fortemi/core` is required and should be installed explicitly.

## Quick Start

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
  const { createNote, loading: creating } = useCreateNote()
  const { data, loading: searching, search } = useSearch()

  return (
    <section>
      <button
        disabled={creating}
        onClick={() => void createNote({ title: 'New note', content: 'Body' })}
      >
        Add note
      </button>

      <input
        aria-label="Search notes"
        onChange={(event) => void search(event.target.value)}
      />

      {searching ? <p>Searching...</p> : null}
      <ul>
        {data?.items.map((result) => (
          <li key={result.id}>{result.title ?? 'Untitled'}</li>
        ))}
      </ul>
    </section>
  )
}
```

## Provider

`FortemiProvider` opens the PGlite archive, runs migrations, creates the event bus, capability manager, archive manager, and blob store, then exposes them through React context. It is the boundary between your React tree and Fortemi's headless runtime.

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `persistence` | <code>'opfs' \| 'idb' \| 'memory'</code> | Yes | - | Storage backend |
| `archiveName` | `string` | No | `'default'` | Logical archive name |
| `executionMode` | <code>'main' \| 'worker'</code> | No | `'main'` | Run PGlite on the main thread or in a Web Worker |
| `createWorker` | `() => Worker` | No | package worker | Custom worker factory for host bundlers |
| `children` | `ReactNode` | Yes | - | Application subtree |

Use `useFortemiContext()` when you need direct access to `db`, `events`, `archiveManager`, `capabilityManager`, or `blobStore`. That lets you mix high-level hooks with custom repository queries, bridge adapters, background handlers, or diagnostics.

Use `executionMode="worker"` for large imports, vector-heavy graph work, or any host where PGlite startup and query execution should not block the UI thread.

## Hooks

| Hook | Purpose |
|---|---|
| `useNotes` | Paginated note listing |
| `useNote` | Single-note fetch |
| `useCreateNote` | Note creation |
| `useUpdateNote` | Note update |
| `useDeleteNote` | Soft delete |
| `useSearch` | Full-text and hybrid semantic search |
| `useSearchHistory` | Query history |
| `useSearchSuggestions` | Autocomplete suggestions |
| `useTags` | Tag management |
| `useCollections` | Collection management |
| `useJobQueue` | AI job queue status and control |
| `useRelatedNotes` | Embedding-based related notes |
| `useNoteConcepts` | SKOS concept tags for a note |
| `useNoteProvenance` | Revision and job provenance timeline |
| `useExportShard` | Knowledge Shard export |
| `useImportShard` | Knowledge Shard import |
| `useShardPrefetch` | Background warming and SHA verification for static shard assets |
| `useGpuCapabilities` | WebGPU and VRAM detection |
| `useInferenceCapabilities` | Hardware inference tier detection |
| `useLocalDiscovery` | Local LLM server discovery |
| `useEmbeddingPipeline` | Embedding pipeline lifecycle |
| `useEmbeddingWorker` | Host-owned worker transport for off-main-thread embedding |
| `useEmbeddingSets` | Named embedding set selection and creation |
| `useSimilarityGraph` | Embedding-set scoped similarity graph construction |
| `useCommunities` | Community source listing and management |
| `useGraphController` | Graph-source mode coordination |
| `useAiwgIndex` | Load, chunk-load, search, review, and project AIWG index exports into graph data |
| `useShard` | In-place read-only Knowledge Shard browsing and search |
| `useRemote` | Network-backed Fortemi server `DataBackend` access |
| `useCapabilitySetup` | Unified capability wiring |

## GraphView

`GraphView` renders graph data produced by similarity APIs or `useAiwgIndex().toCommunityGraph()`. It is designed for review surfaces where users inspect relationships, community clusters, and source records without leaving the local archive UI.

```tsx
import { useEffect, useMemo } from 'react'
import { GraphView, useAiwgIndex } from '@fortemi/react'

function AiwgGraph({ exportJson }: { exportJson: unknown }) {
  const { index, loadIndex, toCommunityGraph } = useAiwgIndex()
  const graph = useMemo(() => (index ? toCommunityGraph() : null), [index, toCommunityGraph])

  useEffect(() => {
    loadIndex(exportJson)
  }, [exportJson, loadIndex])

  return <GraphView graph={graph} height={480} />
}
```

### PGlite-free graph subpath

`GraphView` renders a `CommunityGraph` with no database access — it depends only
on `@fortemi/graph` (layout/filter/color helpers) and React. Consumers that want
just the graph rendering, and never boot a local archive, should import it from
the `@fortemi/react/graph` subpath instead of the package root:

```tsx
import { GraphView } from '@fortemi/react/graph'
```

This subpath carries no reference to `@fortemi/core`, PGlite, or the DB worker,
so the PGlite WASM engine stays out of the bundle and Vite code-split builds do
not trip on the worker/Node-FS chain. Importing `GraphView` from the package
root still works; it just pulls the full provider surface (and therefore PGlite)
into the module graph, since the root barrel also exports `FortemiProvider` and
the DB hooks. PGlite itself is loaded lazily and is an optional dependency of
`@fortemi/core`, so DB-backed consumers pay for it only when an archive is
actually opened.

For large static AIWG indexes, use the chunked hook methods so pages fetch only
the needed manifest parts and the hook does not retain a full export array:

```tsx
import { createAiwgFetchChunkLoader } from '@fortemi/core/aiwg-index'
import { useAiwgIndex } from '@fortemi/react'

function AiwgSearch() {
  const aiwg = useAiwgIndex()

  async function load() {
    const manifest = await fetch('/search/aiwg-index/manifest.json').then((res) => res.json())
    aiwg.loadChunkedIndex(manifest, createAiwgFetchChunkLoader('/search/aiwg-index/'))
    await aiwg.searchChunked('', { offset: 0, limit: 25 })
  }

  return <button onClick={load}>Load</button>
}
```

## When to Use Core Directly

Start with `@fortemi/react` when your application is React-based and most interactions happen in components. Use `@fortemi/core` directly for non-React hosts, browser extensions, service-worker integrations, bridge adapters, or background modules that need repository and tool access outside the React tree. Both packages share the same archive model and are versioned together.

## Browser Compatibility

| Browser | Storage | Notes |
|---|---|---|
| Chrome 113+ / Edge 113+ | OPFS recommended | WebGPU can power local LLM features |
| Firefox 111+ | IndexedDB fallback | WASM embeddings work; WebGPU support is limited |
| Safari 17+ | Memory or IndexedDB depending context | Use `memory` when persistent storage is restricted |

On Linux Chrome, local WebGPU inference commonly needs `--enable-unsafe-webgpu`. Data stays in the selected browser storage mode unless your application explicitly exports it, imports it, or wires external providers. Browser or remote provider API keys should be persisted only through secure browser or machine storage; when that storage is unavailable, keep the provider disabled instead of storing secrets in plain local storage.

## Documentation

- [Getting started](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/getting-started.md)
- [API reference](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/api-reference.md#fortemireact)
- [Integration guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/guides/integration.md)
- [Search guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/guides/search.md)
- [Examples](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/guides/examples.md)

## License

AGPL-3.0-only. See [LICENSE](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
