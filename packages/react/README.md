<div align="center">

# @fortemi/react

**React 19 provider and hooks for local-first Fortemi knowledge archives**

Build React knowledge apps with browser-local PostgreSQL storage, typed hooks, hybrid search, SKOS concepts, job queues, local AI capability setup, and Knowledge Shard import/export.

```bash
pnpm add @fortemi/react @fortemi/core react
```

[![npm version](https://img.shields.io/npm/v/@fortemi/react/latest?label=npm&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/react)
[![npm downloads](https://img.shields.io/npm/dm/@fortemi/react?color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/react)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

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
| Local-first user data | `FortemiProvider` opens OPFS, IndexedDB, or memory-backed PGlite archives |
| Fast note UI | Hooks for note CRUD, lists, single-note reads, deletion, and automatic refresh |
| Search UX | Full-text, semantic, and hybrid search hooks with history and suggestions |
| Knowledge organization | Tags, collections, links, SKOS concepts, related notes, and provenance hooks |
| AI workflows | Job queue, embeddings, capability setup, GPU detection, and local-provider discovery hooks |
| Portability | Knowledge Shard import/export hooks for moving archives between environments |
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
| `children` | `ReactNode` | Yes | - | Application subtree |

Use `useFortemiContext()` when you need direct access to `db`, `events`, `archiveManager`, `capabilityManager`, or `blobStore`. That lets you mix high-level hooks with custom repository queries, bridge adapters, background handlers, or diagnostics.

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
| `useGpuCapabilities` | WebGPU and VRAM detection |
| `useInferenceCapabilities` | Hardware inference tier detection |
| `useLocalDiscovery` | Local LLM server discovery |
| `useEmbeddingPipeline` | Embedding pipeline lifecycle |
| `useEmbeddingSets` | Named embedding set selection and creation |
| `useSimilarityGraph` | Embedding-set scoped similarity graph construction |
| `useCapabilitySetup` | Unified capability wiring |

## When to Use Core Directly

Start with `@fortemi/react` when your application is React-based and most interactions happen in components. Use `@fortemi/core` directly for non-React hosts, browser extensions, service-worker integrations, bridge adapters, or background modules that need repository and tool access outside the React tree. Both packages share the same archive model and are versioned together.

## Browser Compatibility

| Browser | Storage | Notes |
|---|---|---|
| Chrome 113+ / Edge 113+ | OPFS recommended | WebGPU can power local LLM features |
| Firefox 111+ | IndexedDB fallback | WASM embeddings work; WebGPU support is limited |
| Safari 17+ | Memory or IndexedDB depending context | Use `memory` when persistent storage is restricted |

On Linux Chrome, local WebGPU inference commonly needs `--enable-unsafe-webgpu`. Data stays in the selected browser storage mode unless your application explicitly exports it, imports it, or wires external providers.

## Documentation

- [Getting started](https://github.com/Fortemi/fortemi-react/blob/main/docs/getting-started.md)
- [API reference](https://github.com/Fortemi/fortemi-react/blob/main/docs/api-reference.md#fortemireact)
- [Integration guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/integration.md)
- [Search guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/search.md)
- [Examples](https://github.com/Fortemi/fortemi-react/blob/main/docs/examples.md)

## License

AGPL-3.0-only. See [LICENSE](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
