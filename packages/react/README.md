<div align="center">

# @fortemi/react

**React 19 provider and hooks for browser-only Fortemi knowledge archives**

Typed hooks for local notes, hybrid search, tags, collections, SKOS concepts, job queues, capability setup, local inference discovery, and Knowledge Shard import/export.

```bash
pnpm add @fortemi/react @fortemi/core react
```

[![npm version](https://img.shields.io/npm/v/@fortemi/react/latest?label=npm&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/react)
[![npm downloads](https://img.shields.io/npm/dm/@fortemi/react?color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/react)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

[**Install**](#installation) · [**Quick Start**](#quick-start) · [**Hooks**](#hooks) · [**Provider**](#provider) · [**Docs**](#documentation) · [**License**](#license)

</div>

---

## What @fortemi/react Is

`@fortemi/react` is the React integration layer for `@fortemi/core`. It initializes the local Fortemi archive, exposes runtime services through context, and provides hooks for common knowledge-management UI workflows.

Use it when you want to embed Fortemi in a React 19 application without writing repository and event-bus plumbing yourself.

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

`FortemiProvider` opens the PGlite archive, runs migrations, creates the event bus, capability manager, archive manager, and blob store, then exposes them through React context.

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `persistence` | <code>'opfs' \| 'idb' \| 'memory'</code> | Yes | - | Storage backend |
| `archiveName` | `string` | No | `'default'` | Logical archive name |
| `children` | `ReactNode` | Yes | - | Application subtree |

Use `useFortemiContext()` when you need direct access to `db`, `events`, `archiveManager`, `capabilityManager`, or `blobStore`.

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
| `useCapabilitySetup` | Unified capability wiring |

## Browser Compatibility

| Browser | Storage | Notes |
|---|---|---|
| Chrome 113+ / Edge 113+ | OPFS recommended | WebGPU can power local LLM features |
| Firefox 111+ | IndexedDB fallback | WASM embeddings work; WebGPU support is limited |
| Safari 17+ | Memory or IndexedDB depending context | Use `memory` when persistent storage is restricted |

On Linux Chrome, local WebGPU inference commonly needs `--enable-unsafe-webgpu`.

## Documentation

- [Getting started](https://github.com/Fortemi/fortemi-react/blob/main/docs/getting-started.md)
- [API reference](https://github.com/Fortemi/fortemi-react/blob/main/docs/api-reference.md#fortemireact)
- [Integration guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/integration.md)
- [Search guide](https://github.com/Fortemi/fortemi-react/blob/main/docs/search.md)
- [Examples](https://github.com/Fortemi/fortemi-react/blob/main/docs/examples.md)

## License

AGPL-3.0-only. See [LICENSE](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
