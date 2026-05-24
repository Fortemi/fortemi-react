# ADR-007: Deployment Modes

**Date**: 2026-03-22
**Status**: Proposed
**Deciders**: roctinam

---

## Context

fortemi-react was originally planned as a standalone PWA. Discovery that it will serve as the Fortemi embedded app inside the host platform (per host integration requirements) shifts the primary deployment target to an embedded iframe within the host application shell. However, additional deployment modes remain valuable:

- **Standalone mode** — for development, testing, demo, and external MCP client compatibility (Service Worker intercepts `localhost:3000` per ADR-004)
- **Library mode** — for other projects that need Fortemi's data layer without a UI, for test harnesses, and for other host modules that need direct memory access

A single codebase must support all three targets without duplication of business logic.

## Decision

Implement three deployment modes from one monorepo, structured as four packages and two application entry points.

### Mode 1: Embedded Mode (Primary) — `@fortemi/browser`

The Fortemi application embedded in a host application shell iframe.

- Loaded by host application via iframe with bridge initialization
- Uses a host bridge adapter client for typed postMessage communication over MessageChannel
- Registers Fortemi tools as `BridgeCapability` entries (e.g., `fortemi.search`, `fortemi.capture_knowledge`) with JSON Schema input/output definitions
- `BridgeAdapter` maps capability invocations to `FortemiCore` tool calls
- Storage: PGlite with browser-appropriate persistence — OPFS on Chrome/Edge, IDB on Firefox, in-memory on Safari (per ADR-005)
- No Service Worker — the bridge protocol is the primary interface for agentic consumers
- UI: React components rendered inside the embedded iframe

### Mode 2: Library Mode — `@fortemi/core`

Headless package for programmatic access.

- No React, no browser-specific APIs in the core module itself
- `createFortemi(config)` factory function returns a `FortemiCore` instance
- Consumers call repositories and tools directly via typed TypeScript APIs
- Storage: PGlite in-memory for testing; OPFS/IDB in browser contexts
- PGlite Worker for single-writer enforcement (per ADR-003)
- Use cases: test suites, other host modules needing memory access, Node.js scripts, CI

### Mode 3: Standalone Mode — `@fortemi/standalone`

Full application for development, demos, and external tool compatibility.

- Complete React UI for browsing and managing Fortemi data
- Optional Service Worker for external MCP client compatibility (per ADR-004)
- SW intercepts `fetch()` to `localhost:3000/api/*`, serving responses from PGlite
- Manual JSON-RPC 2.0 dispatch for MCP tool handlers (per ADR-004 Errata #3)
- Runs independently — no host application shell required

## Package Structure

```
packages/
  core/             → @fortemi/core
                      Headless: repositories, tools, event bus, PGlite worker,
                      schema migrations, type definitions
  react/            → @fortemi/react
                      React hooks, providers, UI components over core
  bridge/           → @fortemi/bridge
                      BridgeAdapter, capability registration,
                      bridge protocol types
  sw/               → @fortemi/sw
                      Service Worker REST adapter, JSON-RPC dispatcher
                      over core (optional, standalone only)
apps/
  embedded/            → Fortemi embedded app entry point (embedded mode)
  standalone/       → Standalone SPA entry point
```

## Dependency Graph

```
@fortemi/core              ← zero browser-only deps, headless
  ↑           ↑
  │           │
@fortemi/react   @fortemi/sw
  ↑           ↑
  │           │
@fortemi/bridge  apps/standalone
  ↑
  │
apps/embedded
```

- `@fortemi/core` is the leaf dependency. It must not import from `react`, a host bridge adapter, or any browser-only API directly.
- `@fortemi/react` depends only on `core` and `react`.
- `@fortemi/bridge` depends on `core` and a host bridge adapter.
- `@fortemi/sw` depends on `core` only.
- Application entry points compose the packages they need.

## Build Targets

| Mode | Entry | Bundler | Output | Includes |
|---|---|---|---|---|
| Embedded | `apps/embedded/index.tsx` | Vite 7 | `dist/` (iframe-loadable) | core + react + bridge |
| Library | `packages/core/index.ts` | tsup | `dist/` (ESM + CJS) | core only |
| Standalone | `apps/standalone/index.tsx` | Vite 7 | `dist/` (static SPA) | core + react + sw |

## Configuration

```typescript
interface FortemiConfig {
  persistence: 'opfs' | 'idb' | 'memory'
  archiveName: string

  capabilities: {
    semantic: { enabled: boolean }
    llm: {
      enabled: boolean
      provider?: 'webllm' | 'external'
      apiKey?: string
    }
  }

  bridge?: BridgeClient  // embedded mode only
}

const fortemi: FortemiCore = await createFortemi(config)
```

## Consequences

**Positive:**
- Single source of truth for business logic in `@fortemi/core`
- Each deployment mode is a thin adapter over core — no logic duplication
- Test suites use library mode directly (fast, no browser environment needed)
- Embedded mode is lightweight (no Service Worker overhead)
- Library consumers get a clean npm package with no React or browser coupling
- Independent versioning per package if needed, or lockstep via monorepo tooling

**Negative:**
- Monorepo management overhead (4+ packages, workspace configuration, cross-package type checking)
- `@fortemi/core` must maintain zero browser-only dependencies — PGlite access needs an adapter interface that works in both Worker and non-Worker contexts
- `@fortemi/bridge` must stay in sync with host bridge protocol changes — breaking protocol changes require coordinated releases
- Two Vite build configurations to maintain (organ + standalone)

## Related Decisions

- **ADR-001** — PGlite as storage engine (core dependency)
- **ADR-002** — Capability modules (opt-in WASM, configured per mode)
- **ADR-003** — PGlite single-writer pattern (core manages this)
- **ADR-004** — Service Worker REST API (standalone mode only)
- **ADR-005** — Browser compatibility matrix (persistence selection per browser)
- **ADR-006** — Public API as primary interface (this ADR implements that decision)
