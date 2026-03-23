# fortemi-react

Browser-only knowledge management system with full PostgreSQL (PGlite WASM), semantic search (pgvector + transformers.js), SKOS tagging, and MCP tool integration. 100% JSON format parity with fortemi server. React 19 / TypeScript / AGPL-3.0.

## Quick Start

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

## Architecture

pnpm monorepo with three packages:

| Package | Description |
|---|---|
| `@fortemi/core` | Headless data layer: PGlite repositories, migrations, workers, MCP tools, event bus, capability system |
| `@fortemi/react` | React 19 hooks and FortemiProvider for UI consumers |
| `@fortemi/standalone` | Vite 7 application with note list, search, settings UI |

All data stays in-browser via PGlite (PostgreSQL compiled to WASM):
- **Chrome 113+** (tested: 146): OPFS persistence (fastest), WebGPU for LLM
- **Firefox 111+** (tested: 148): IndexedDB adapter, WASM embedding (no WebGPU production support yet)
- **Safari 17+**: In-memory (no persistent storage)

No server required. Deploy `apps/standalone/dist/` to any static host.

## Features

- Full note CRUD with revision history and soft-delete
- Full-text search (PostgreSQL tsvector/tsquery)
- Hybrid semantic search (pgvector HNSW + BM25 RRF fusion)
- SKOS taxonomy management (schemes, concepts, relations)
- Tags, collections, and inter-note links
- 13 MCP tool functions for AI agent integration
- Opt-in capability modules: embeddings (transformers.js), LLM (WebLLM), GPU detection
- Multi-archive support (separate PGlite instances)
- Job queue with retry logic (title generation, embedding, auto-tagging)

## Testing

```bash
pnpm test:core    # 603 unit/integration tests (Vitest)
pnpm test:e2e     # 16 E2E tests across Chromium + Firefox (Playwright)
pnpm typecheck    # TypeScript strict
pnpm lint         # ESLint
```

Coverage: 88.56% statements, 96.89% repository layer, 90.24% lines.

## Build

```bash
pnpm build                                          # Build all packages
pnpm --filter @fortemi/standalone preview            # Preview production build
```

## AI Capabilities

fortemi-react supports opt-in AI features through the capability system. Enable them in Settings.

### Semantic Search (all browsers)

Downloads the `all-MiniLM-L6-v2` embedding model (~23MB) via transformers.js (WASM). No GPU needed.

Enables: Generate Embedding, Find Links, hybrid semantic search.

### Local LLM (Chrome/Edge with WebGPU)

Downloads a local language model via WebLLM. Requires WebGPU.

Enables: AI Revision, Concept Tagging, LLM-powered title generation.

### GPU Setup (Linux)

WebGPU requires proper GPU driver setup. Check `chrome://gpu` — look for `WebGPU: Hardware accelerated`.

If WebGPU shows as disabled:

```bash
# Ensure Vulkan is available
vulkaninfo | head -20

# Launch Chrome with Vulkan backend (if not auto-detected)
google-chrome --enable-features=Vulkan --enable-unsafe-webgpu

# NVIDIA users: ensure proprietary drivers are installed
nvidia-smi
```

For Intel integrated GPUs, Mesa drivers (25.x+) provide Vulkan support automatically. The NVIDIA discrete GPU can be selected in Chrome via `chrome://flags/#enable-webgpu-developer-features`.

### Job Queue

All AI operations run through a background job queue matching the fortemi server's pipeline:

| Job Type | Priority | Requires | Description |
|---|---|---|---|
| `title_generation` | 2 | none (LLM optional) | Extract or generate title from content |
| `linking` | 3 | embeddings exist | Discover semantically related notes |
| `embedding` | 5 | Semantic capability | Generate vector embedding for search |
| `concept_tagging` | 5 | LLM capability | Extract topic tags via LLM |
| `ai_revision` | 8 | LLM capability | LLM-based content enhancement |

Jobs that require unavailable capabilities stay queued as `pending` and run automatically when the capability is enabled.

## MCP Integration

fortemi-react exposes 13 tools via MCP JSON-RPC (Service Worker interception):

`capture_knowledge`, `manage_note`, `search`, `get_note`, `list_notes`, `manage_tags`, `manage_collections`, `manage_links`, `manage_archive`, `manage_capabilities`

Tool manifest available at runtime via `@fortemi/core` exports.

## License

AGPL-3.0-only
