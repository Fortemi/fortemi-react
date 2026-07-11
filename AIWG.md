# CLAUDE.md
<!-- aiwg-managed -->
<!-- AIWG.md is the CLAUDE.md companion for non-Claude providers; same content. -->


This file provides guidance to Claude Code when working with this codebase.

## Repository Purpose

fortemi-react is the React port of the fortemi knowledge management server (Rust/PostgreSQL). It runs entirely in-browser using PGlite (PostgreSQL WASM), maintains 100% JSON format parity with the server, and is designed to be embedded in React applications (primary consumer: host platform Fortemi embedded app).

## Tech Stack

- **Runtime**: Browser (no server required)
- **Language**: TypeScript (strict mode)
- **UI**: React 19.2.4
- **Database**: PGlite 0.4.1 (PostgreSQL WASM) with pgvector
- **Build**: Vite 7.3.1, pnpm 10.6.5 workspaces
- **Test**: Vitest 4.1.0 (991 core tests across 54 files; + graph & react suites), Playwright 1.52.x (E2E)
- **Lint**: ESLint 9.x (flat config) + typescript-eslint v8
- **AI**: transformers.js (embeddings), WebLLM (local LLM), InferenceProvider system (remote + local + fallback)
- **License**: AGPL-3.0-only
- **Versioning**: CalVer YYYY.M.PATCH (no leading zeros)
- **Current version**: 2026.7.3

## Monorepo Structure

```
packages/core/       @fortemi/core — headless data layer (PGlite, repos, tools, workers, migrations, shard)
packages/graph/      @fortemi/graph — framework-agnostic graph add-on (layout, filter, color, degree, bounds, neighborhood, snapshot, GraphController); depends on @fortemi/core, no React
packages/react/      @fortemi/react — React hooks, FortemiProvider, GraphView (uses @fortemi/graph)
apps/standalone/     @fortemi/standalone — Vite demo app (private, not published)
```

Dependency direction (linear chain, no cycles): `@electric-sql/pglite` ← `@fortemi/core` ← `@fortemi/graph` ← `@fortemi/react`. `@fortemi/core` is the base and never depends on graph; `@fortemi/graph` depends on core (for `GraphController` and shared graph types) and is consumed by `@fortemi/react` and JS-only hosts.

## Development Commands

```bash
pnpm dev              # Vite dev server on :5173
pnpm build            # Build all packages
pnpm test:core        # 991 unit/integration tests (Vitest)
pnpm test:e2e         # E2E tests (Playwright, Chromium + Firefox)
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
- **Knowledge Shard** — import/export system: tar.gz bundles with checksums, conflict strategies, field-mapped JSON format parity
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
| `packages/core/src/migrations/` | 10 numbered migrations (schema must match server); `0010` adds attachment MIME and extracted-text metadata |
| `packages/core/src/tools/` | 11 MCP tool functions (capture-knowledge, get-note, list-notes, manage-note, manage-tags, manage-collections, manage-links, manage-archive, manage-capabilities, manage-attachments, search) |
| `packages/core/src/repositories/` | 11 data access repositories (notes, search, tags, collections, links, skos, attachments, communities, graph, provenance, embedding-sets) |
| `packages/core/src/capabilities/` | 14 files: InferenceProvider interface, ProviderRegistry, OpenAICompatibleProvider, FallbackRouter, local-discovery, gpu-detect, inference-detect, embedding-handler, embed-worker-transport, llm-handler, semantic-loader, llm-loader, auto-tag, chunking |
| `packages/core/src/shard/` | Knowledge Shard import/export: tar packaging, checksums, field-mapper, types, and shard↔server conformance harness |
| `packages/core/src/security/plugin-content.ts` | Validation and safety policy for plugin-provided content |
| `packages/core/src/worker/` | PGlite worker protocol, client, and worker entry (single-writer serialization) |
| `packages/core/src/service-worker/` | SW registration, route matching, and SW entry (MCP REST interception) |
| `packages/react/src/FortemiProvider.tsx` | React context (db, events, archiveManager, capabilityManager, blobStore) |
| `packages/react/src/hooks/` | 30 hook modules exporting 30 hooks; `useFortemiContext` brings the package export surface to 31 hooks |
| `apps/standalone/src/capabilities/setup.ts` | Real transformers.js + WebLLM wiring |
| `.aiwg/` | SDLC documentation (SAD, ADRs, gates, plans, requirements) |

## Testing

- **Format parity tests are the highest priority** — if they break, nothing ships
- 991 tests across 54 files in `packages/core/src/__tests__/` (including `format-parity/`, shard conformance, and `shard/` subdirs)
- E2E tests in `apps/standalone/e2e/` (`smoke`, `loading`, and `webkit-compat`, Playwright)
- Run `pnpm test:coverage` for current coverage; do not rely on hardcoded historical percentages.

## React Hooks Reference

All 31 hooks exported from `@fortemi/react`:

| Hook | Purpose |
|------|---------|
| `useNotes` | Paginated note listing |
| `useNote` | Single note fetch |
| `useCreateNote` | Note creation |
| `useUpdateNote` | Note update |
| `useDeleteNote` | Soft-delete |
| `useSearch` | Full-text and semantic search |
| `useSearchHistory` | Query history |
| `useSearchSuggestions` | Auto-complete suggestions |
| `useTags` | Tag management |
| `useCollections` | Collection management |
| `useJobQueue` | AI job queue status/control |
| `useRelatedNotes` | Embedding-based related notes |
| `useNoteConcepts` | SKOS concept tags for a note |
| `useNoteProvenance` | Revision history |
| `useExportShard` | Knowledge Shard export |
| `useImportShard` | Knowledge Shard import |
| `useGpuCapabilities` | WebGPU/VRAM detection |
| `useInferenceCapabilities` | Hardware inference tier detection |
| `useLocalDiscovery` | Local LLM server discovery (Ollama, LM Studio, etc.) |
| `useEmbeddingPipeline` | Embedding pipeline lifecycle |
| `useCapabilitySetup` | Unified capability wiring |
| `useFortemiContext` | Access the FortemiProvider context (db, events, managers) |
| `useGraphController` | Graph-source controller (mode selection + load dispatch) |
| `useCommunities` | Graph community management (create, assign, summarize) |
| `useSimilarityGraph` | Build a community graph from embedding similarity |
| `useEmbeddingSets` | Named and virtual embedding set management |
| `useEmbeddingWorker` | Embedding worker transport lifecycle |
| `useShard` | Open and read a Knowledge Shard |
| `useShardPrefetch` | Prefetch and cache a Knowledge Shard |
| `useRemote` | Remote backend access (notes, search) |
| `useAiwgIndex` | Query the AIWG artifact index and project it to a community graph |

## Browser Compatibility

- Chrome 113+ (tested: 146) — OPFS persistence, WebGPU for LLM
- Firefox 111+ (tested: 148) — IndexedDB adapter, WASM embedding only
- Safari 17+ — in-memory only
- WebGPU on Linux requires `--enable-unsafe-webgpu` Chrome flag

## Git Remotes

- `origin` — Gitea (internal, primary): `git@git.integrolabs.net:Fortemi/fortemi-react.git`
- `github` — GitHub (public, publish target): `https://github.com/Fortemi/fortemi-react.git`

---

## AIWG Framework Integration

Active frameworks (installed 2026-03-20):

| Framework | Version | Purpose |
|-----------|---------|---------|
| `sdlc-complete` | 1.0.0 | SDLC orchestration, gates, Ralph loops, artifact tracking |
| `research-complete` | 1.0.0 | Research corpus management, FAIR metadata, citation policy |
| `media-marketing-kit` | 1.0.0 | Media and marketing workflows |
| `media-curator` | 1.0.0 | Media curation |
| `forensics-complete` | 1.0.0 | Security forensics and incident response |

Deployed assets:

- **162 agents** in `.claude/agents/` — full SDLC role coverage (code review, architecture, security, test, documentation, SDLC orchestration, marketing, forensics, and more)
- **167 commands** in `.claude/commands/` — SDLC flows, Ralph loops, research workflows, issue management, project health, and devkit operations

Rules active from AIWG: see `.claude/rules/RULES-INDEX.md` — 35 rules across core, SDLC, and research tiers.

---

<!-- USER NOTES - Content below preserved during regeneration -->

<!-- AIWG:claude-md-hook:start -->

# AIWG


<!--
  This block is managed by `aiwg regenerate` and `aiwg use`.
  Operator content above and below this block is preserved on regenerate.
  To change AIWG.md content, edit .aiwg/AIWG.md (the normalized source)
  then run `aiwg regenerate`.
-->

<!-- AIWG:claude-md-hook:end -->

<!-- AIWG-PARALLELISM-CAP:START -->
## Parallelism Cap

This project caps parallel agent fan-out (#1359):

- **max_parallel_subagents**: 10 (provider default for codex)
- **max_parallel_ralph_loops**: 3 (provider default for codex)
- **max_parallel_mc_missions**: 6 (provider default for codex)

*Rationale*: Provider default for codex — adjust via 'aiwg config set --project parallelism.max_parallel_subagents N'

When spawning parallel subagents, take the MIN of: this cap, `AIWG_CONTEXT_WINDOW` budget, the RLM 7-agent hard cap (RLM dispatches only), and the natural task decomposition. Bump via `aiwg config set --project parallelism.max_parallel_subagents N`.

<!-- AIWG-PARALLELISM-CAP:END -->

<!-- aiwg-context-finalization:START -->
## Context Finalization

This section is synthesized after template emission from the current workspace state. Preserve operator-authored content outside AIWG-managed blocks; rerun `aiwg regenerate` to refresh this section after provider, framework, or MCP wiring changes.

### Workspace Snapshot

- Configured providers: codex
- Installed frameworks/addons: all
- Recorded deployments: codex
- Normalized project context: `.aiwg/AIWG.md`

### Discover-First Protocol

Classify every user turn FIRST: is it a **new directive** or a continuation? When a message names or references an AIWG command/capability — even as pasted content like an `address-issues` tracker table, an issue list, or a `flow-*` name — treat it as a new directive and ACT: run `aiwg discover "<the need>"`, fetch with `aiwg show <type> <name>`, and invoke it. Do NOT ask "what would you like me to do with these?" when the action is implied — a pasted `address-issues #1234` table means run the address-issues workflow on those issues.

Also run `aiwg discover` before declining an AIWG request as out of scope or inventing a workflow from memory. The CLI ranks AIWG capabilities across the installed corpus and rebuilds the index from `$AIWG_ROOT` automatically, so a "no matches" for a command you know is deployed is a bug — not a signal it is absent. Commands AIWG deploys to your provider command directory (`.opencode/command/`, `.claude/commands/`, `~/.codex/prompts/`, …) ARE discoverable this way; fetch them with `aiwg show command <name>`. This prevents decline-without-search failures, ask-instead-of-act on new directives, and hallucinated skill or agent names. Full rule: `agentic/code/addons/aiwg-utils/rules/skill-discovery.md`.

### Engagement Verification

When a user asks whether AIWG is active or engaged in this project, run or read `aiwg status --probe --json` and report the result plainly: engaged state, project root, deployed provider files, installed frameworks/addons, and the next action from the probe. Do not add AIWG attribution, signatures, generated-by text, or passive footers to user files, commits, PRs, comments, code headers, or docs.

### Tracker Authority Protocol

- Source of truth: [.aiwg/aiwg.config](./.aiwg/aiwg.config)
- Canonical tracker: `origin` (unknown; git@git.integrolabs.net:Fortemi/fortemi-react.git)
- Primary repo remote: `origin`; CI remote: `origin`
- Secondary/mirror remotes: github (backup-mirror)
- Issue storage mode: not configured

Tracker access order for issue, PR, release, and CI-sensitive tracker operations:
1. MCP/app tools for the configured tracker.
2. Tracker HTTP API with configured credentials.
3. Tracker CLI for the configured tracker, after confirming authentication.
4. Stop and report a blocker.

- Project config decides tracker authority; installed/authenticated CLIs do not.
- Git SSH remote access is repository sync, not issue-tracker API access.
- Do not file on mirror or secondary remotes just because their CLI is authenticated.
- Treat an unauthenticated tracker CLI as one failed access path, then continue probing MCP/app/API before blocking.

### Source Model

- `.aiwg/AIWG.md` is the normalized project-local context entry point.
- Root `AIWG.md` is the generated cross-provider companion loaded through `AGENTS.md` and provider twins.
- `AGENTS.md`, `WARP.md`, `.hermes.md`, and `.github/copilot-instructions.md` are provider-facing bridges, not replacements for `.aiwg/AIWG.md`.
<!-- aiwg-context-finalization:END -->
