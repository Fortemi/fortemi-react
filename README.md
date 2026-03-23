# fortemi-browser

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
- **Chrome**: OPFS persistence (fastest)
- **Firefox**: IndexedDB adapter
- **Safari**: In-memory (no persistent storage)

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

## MCP Integration

fortemi-browser exposes 13 tools via MCP JSON-RPC (Service Worker interception):

`capture_knowledge`, `manage_note`, `search`, `get_note`, `list_notes`, `manage_tags`, `manage_collections`, `manage_links`, `manage_archive`, `manage_capabilities`

Tool manifest available at runtime via `@fortemi/core` exports.

## License

AGPL-3.0-only
