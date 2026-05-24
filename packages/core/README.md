# @fortemi/core

Browser-only knowledge management core. PGlite (PostgreSQL WASM) data layer, single-writer worker, 10 manifest-backed MCP tools and 11 direct tool helpers, job queue, capability system, SKOS taxonomy, hybrid search. 100% JSON format parity with the [`fortemi`](https://github.com/Fortemi/fortemi) Rust server.

## Install

```bash
pnpm add @fortemi/core
# or
npm install @fortemi/core
```

Peer-installed dependencies — these install automatically as regular dependencies:

- `@electric-sql/pglite` — PostgreSQL compiled to WASM
- `@noble/hashes` — cryptographic hashing
- `fflate` — gzip / tar for Knowledge Shards
- `uuid` — UUIDv7 generation
- `zod` — runtime validation

## Quick start

```ts
import {
  ArchiveManager,
  NotesRepository,
  SearchRepository,
  TypedEventBus,
  registerServiceWorker,
} from "@fortemi/core"

const events = new TypedEventBus()
const archiveManager = new ArchiveManager("opfs", events)
const db = await archiveManager.open("default")

const notes = new NotesRepository(db, events)
const search = new SearchRepository(db)

const note = await notes.create({
  title: "Hello",
  content: "First note in the local archive.",
})

const results = await search.search("hello")

// Optional: register standalone service-worker routes.
await registerServiceWorker()
```

## What it provides

| Surface | Description |
|---|---|
| **PGlite worker** | Single-writer Postgres WASM in a dedicated worker; all DB operations serialized via `postMessage` |
| **Repositories** | Notes, search, tags, collections, links, SKOS concepts, attachments |
| **MCP manifest tools** | `capture_knowledge`, `manage_note`, `search`, `get_note`, `list_notes`, `manage_tags`, `manage_collections`, `manage_links`, `manage_archive`, `manage_capabilities` |
| **Service worker** | Registers browser request interception routes for the standalone app; REST handlers currently return 503 until a database connection is injected. |
| **Capability system** | Opt-in WASM modules: embeddings (transformers.js), local LLM (WebLLM), GPU detection |
| **Inference providers** | OpenAI-compatible (remote + local), auto-discovery (Ollama, LM Studio, llama.cpp, vLLM, Jan), capability-aware fallback |
| **Job queue** | Server-compatible pipeline: `ai_revision` (1), `title_generation` (2), `embedding` (3), `concept_tagging` (4), `linking` (5) |
| **Knowledge Shards** | Tar.gz bundles with checksums for import/export; field-mapped JSON format parity |
| **Migrations** | 5 numbered schema migrations matching the fortemi server |

## React bindings

If you're building a React app, use [`@fortemi/react`](https://www.npmjs.com/package/@fortemi/react) instead — it wraps `@fortemi/core` with `FortemiProvider` and 21 hooks.

## License

[AGPL-3.0-only](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE).
