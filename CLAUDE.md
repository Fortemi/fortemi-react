# CLAUDE.md

This file provides guidance to Claude Code when working with this codebase.

## Repository Purpose

fortemi-react is the React port of the fortemi knowledge management server (Rust/PostgreSQL). It runs entirely in-browser using PGlite (PostgreSQL WASM), maintains 100% JSON format parity with the server, and is designed to be embedded in React applications (primary consumer: Plinyverse MNEMOS organ).

## Tech Stack

- **Runtime**: Browser (no server required)
- **Language**: TypeScript (strict mode)
- **UI**: React 19.2.4
- **Database**: PGlite 0.4.1 (PostgreSQL WASM) with pgvector
- **Build**: Vite 7.3.1, pnpm 10.6.5 workspaces
- **Test**: Vitest 4.1.0 (813+ tests), Playwright 1.58.2 (16 E2E tests)
- **Lint**: ESLint 9.x (flat config) + typescript-eslint v8
- **AI**: transformers.js (embeddings), WebLLM (local LLM), InferenceProvider system (remote + local + fallback)
- **License**: AGPL-3.0-only
- **Versioning**: CalVer YYYY.M.PATCH (no leading zeros)

## Monorepo Structure

```
packages/core/       @fortemi/core — headless data layer (PGlite, repos, tools, workers, migrations)
packages/react/      @fortemi/react — React hooks, FortemiProvider
apps/standalone/     @fortemi/standalone — Vite demo app (private, not published)
```

## Development Commands

```bash
pnpm dev              # Vite dev server on :5173
pnpm build            # Build all packages
pnpm test:core        # 813+ unit/integration tests (Vitest)
pnpm test:e2e         # 16 E2E tests (Playwright, Chromium + Firefox)
pnpm typecheck        # TypeScript strict across all packages
pnpm lint             # ESLint
```

Test parallelism is capped at half available CPUs (PGlite WASM is CPU-heavy). Override with `VITEST_MAX_WORKERS=N`.

## Architecture

- **Single-writer PGlite Worker** — all DB writes serialized via postMessage (ADR-003)
- **Service Worker REST interception** — intercepts localhost:3000 for MCP tools (ADR-004)
- **Capability module system** — opt-in WASM loading, no downloads by default (ADR-002)
- **Inference provider system** — formal `InferenceProvider` interface, `ProviderRegistry` for runtime swapping, `OpenAICompatibleProvider` for remote/local APIs, `FallbackRouter` with cooldown and capability-aware routing, local server auto-discovery (Ollama, LM Studio, llama.cpp, vLLM, Jan)
- **Job queue** — server-compatible pipeline: ai_revision (1), title_generation (2), embedding (3), concept_tagging (4), linking (5). Lower number = higher priority.
- **Format parity** — JSON output must match fortemi server exactly. Format parity tests enforce this.
- **Tiered persistence** — Chrome: OPFS, Firefox: IndexedDB, Safari: in-memory

## Non-Negotiables

1. **UUIDv7** primary keys everywhere (sync compatibility)
2. **Soft-delete** (`deleted_at`) on all mutable entities — never hard-delete
3. **JSON field names identical to server** — format parity tests enforce this
4. **No WASM loaded by default** — capability module system gates all ML models
5. **AGPL-3.0** — no proprietary dependencies
6. **CalVer** — YYYY.M.PATCH, no leading zeros, npm rejects leading zeros

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/index.ts` | All public exports from @fortemi/core |
| `packages/core/src/job-queue-worker.ts` | Job queue with all server-compatible handlers |
| `packages/core/src/migrations/` | 5 numbered migrations (schema must match server) |
| `packages/core/src/tools/` | 11 MCP tool functions |
| `packages/core/src/repositories/` | 9 data access repositories |
| `packages/core/src/capabilities/` | Inference provider system: InferenceProvider, ProviderRegistry, OpenAICompatibleProvider, FallbackRouter, local discovery, hardware detection |
| `packages/react/src/FortemiProvider.tsx` | React context (db, events, archiveManager, capabilityManager, blobStore) |
| `packages/react/src/hooks/` | 21 React hooks (notes, search, capabilities, job queue, import/export) |
| `apps/standalone/src/capabilities/setup.ts` | Real transformers.js + WebLLM wiring |
| `.aiwg/` | SDLC documentation (SAD, ADRs, gates, plans, requirements) |

## Testing

- **Format parity tests are the highest priority** — if they break, nothing ships
- Tests in `packages/core/src/__tests__/`
- E2E tests in `apps/standalone/e2e/`
- Coverage: 88% statements, 97% repository layer

## Browser Compatibility

- Chrome 113+ (tested: 146) — OPFS persistence, WebGPU for LLM
- Firefox 111+ (tested: 148) — IndexedDB adapter, WASM embedding only
- Safari 17+ — in-memory only
- WebGPU on Linux requires `--enable-unsafe-webgpu` Chrome flag

## Git Remotes

- `origin` — Gitea (internal, primary): `git@git.integrolabs.net:Fortemi/fortemi-react.git`
- `github` — GitHub (public, publish target): `https://github.com/Fortemi/fortemi-react.git`

<!--
  USER NOTES
  Add team directives, conventions, or project-specific notes below.
  Content in preserved sections is maintained during regeneration.
  Use <!-- PRESERVE --> markers for content that must be kept.
-->
