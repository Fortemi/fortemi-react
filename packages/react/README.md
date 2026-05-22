# @fortemi/react

React 19 hooks and `FortemiProvider` for the browser-only [`@fortemi/core`](https://www.npmjs.com/package/@fortemi/core) knowledge management system. Twenty-one hooks covering notes, hybrid search, tags, collections, SKOS concepts, job queue, capability setup, embeddings, and Knowledge Shard import/export.

## Install

```bash
pnpm add @fortemi/react @fortemi/core react
# or
npm install @fortemi/react @fortemi/core react
```

`react` is a peer dependency (`^19.0.0`). `@fortemi/core` is required and installs separately.

## Quick start

```tsx
import { FortemiProvider, useSearch, useCreateNote } from '@fortemi/react';

function App() {
  return (
    <FortemiProvider archive="default" persistence="auto">
      <Notebook />
    </FortemiProvider>
  );
}

function Notebook() {
  const search = useSearch();
  const create = useCreateNote();

  return (
    <>
      <input
        placeholder="search"
        onChange={(e) => search.run({ text: e.target.value })}
      />
      <button onClick={() => create.mutate({ title: 'New', body: 'Body' })}>
        Add note
      </button>
      <ul>
        {search.results?.items.map((r) => (
          <li key={r.id}>
            <strong>{r.title}</strong> — {r.snippet}
          </li>
        ))}
      </ul>
    </>
  );
}
```

## Hooks

| Hook | Purpose |
|---|---|
| `useNotes` | Paginated note listing |
| `useNote` | Single-note fetch |
| `useCreateNote` | Note creation |
| `useUpdateNote` | Note update |
| `useDeleteNote` | Soft-delete |
| `useSearch` | Full-text and hybrid semantic search |
| `useSearchHistory` | Query history |
| `useSearchSuggestions` | Autocomplete suggestions |
| `useTags` | Tag management |
| `useCollections` | Collection management |
| `useJobQueue` | AI job queue status / control |
| `useRelatedNotes` | Embedding-based related notes |
| `useNoteConcepts` | SKOS concept tags for a note |
| `useNoteProvenance` | Revision history |
| `useExportShard` | Knowledge Shard export |
| `useImportShard` | Knowledge Shard import |
| `useGpuCapabilities` | WebGPU / VRAM detection |
| `useInferenceCapabilities` | Hardware inference tier detection |
| `useLocalDiscovery` | Local LLM server discovery (Ollama, LM Studio, etc.) |
| `useEmbeddingPipeline` | Embedding pipeline lifecycle |
| `useCapabilitySetup` | Unified capability wiring |

## Browser compatibility

- **Chrome 113+** — OPFS persistence (fastest), WebGPU for local LLM
- **Firefox 111+** — IndexedDB adapter, WASM embeddings (no WebGPU yet)
- **Safari 17+** — in-memory only

WebGPU on Linux Chrome requires `--enable-unsafe-webgpu`.

## License

[AGPL-3.0-only](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
