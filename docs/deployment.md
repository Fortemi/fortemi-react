# Deployment and Operations Guide

This guide covers building, hosting, and operating fortemi-react in production environments. It targets DevOps engineers and developers responsible for shipping and maintaining the application.

---

## Table of Contents

1. [Build](#build)
2. [Static Hosting](#static-hosting)
3. [Vite Configuration for Consumers](#vite-configuration-for-consumers)
4. [Browser Requirements](#browser-requirements)
5. [WebGPU Setup on Linux](#webgpu-setup-on-linux)
6. [Data Persistence](#data-persistence)
7. [Model Downloads](#model-downloads)
8. [CI/CD](#cicd)
9. [Monitoring](#monitoring)
10. [Versioning](#versioning)
11. [Troubleshooting](#troubleshooting)

---

## Build

### Building the standalone app

The standalone app lives at `apps/standalone`. Run the following from the repository root:

```bash
pnpm build
```

This runs `tsc && vite build` inside `apps/standalone`. TypeScript is checked before the bundle is produced — a type error will stop the build.

Output is written to:

```
apps/standalone/dist/
```

The directory is a standard static site: one `index.html`, chunk JS files with content-addressed names, and any static assets copied from `public/`. There are no server-side components.

### Running a local production preview

```bash
cd apps/standalone
pnpm preview
```

`vite preview` serves `dist/` on `http://localhost:4173` with the same headers that production requires. Use this to verify the build before deploying.

### Build-time environment

The build requires Node.js 22 and pnpm 10. The CI pipeline pins these versions explicitly (see [CI/CD](#cicd)). Using older Node versions may produce incorrect output because `@electric-sql/pglite` uses Node 22 APIs in its package resolution.

---

## Static Hosting

The `dist/` directory can be served from any static hosting platform. There are no backend requirements and no server-side rendering.

### Required HTTP headers

PGlite uses `SharedArrayBuffer` for its WebAssembly runtime. Browsers only expose `SharedArrayBuffer` in cross-origin-isolated contexts, which requires two HTTP response headers on every page and every asset:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these headers, PGlite will fail to initialize and the application will not load. These headers must be set on the HTML document and on all JS, CSS, and WASM assets.

### Platform-specific configuration

**Netlify** — add a `netlify.toml` at the root of your deploy directory:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

**Vercel** — add a `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

**Cloudflare Pages** — add a `_headers` file in the `dist/` directory (or the static assets root):

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**Nginx** — add to your `server` block:

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

**Apache** — add to `.htaccess` or the `VirtualHost` block:

```apache
Header always set Cross-Origin-Opener-Policy "same-origin"
Header always set Cross-Origin-Embedder-Policy "require-corp"
```

**Caddy** — add to your `Caddyfile`:

```caddy
header {
    Cross-Origin-Opener-Policy "same-origin"
    Cross-Origin-Embedder-Policy "require-corp"
}
```

### SPA routing

The app uses client-side routing. Configure your host to serve `index.html` for all routes that do not match a static file:

- Netlify: add `[[redirects]] from = "/*" to = "/index.html" status = 200` in `netlify.toml`
- Vercel: add `"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]` in `vercel.json`
- Nginx: add `try_files $uri $uri/ /index.html;`
- Caddy: add `try_files {path} /index.html`

---

## Vite Configuration for Consumers

If you are embedding `@fortemi/core` or `@fortemi/react` in your own Vite application rather than using the standalone build, your `vite.config.ts` requires the following settings.

### Minimum required configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    // PGlite ships pre-bundled WASM. Vite's dependency optimizer must not
    // attempt to re-bundle it, or the WASM loading will break at runtime.
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    // Web Workers in @fortemi/core use ES module syntax.
    // The default 'iife' format does not support ES module imports inside workers.
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
```

Both settings are required. Omitting `optimizeDeps.exclude` causes Vite to consume the WASM response body during its transform pipeline, which breaks `WebAssembly.compileStreaming()`. Omitting `worker.format: 'es'` causes worker instantiation to fail at runtime because the worker scripts use ES import statements.

### WASM streaming in development

During `vite dev`, Vite's middleware reads response bodies for its transform pipeline. This breaks `WebAssembly.compileStreaming()` for `.wasm` files. The standalone app works around this with a custom Vite plugin (`pgliteWasmPlugin` in `apps/standalone/vite.config.ts`) that intercepts `.wasm` requests and pipes them directly from disk, bypassing Vite's transform.

If you encounter `TypeError: Failed to execute 'compileStreaming'` during development, add a similar plugin to your Vite config:

```typescript
import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

function pgliteWasmPlugin(): Plugin {
  return {
    name: 'pglite-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('.wasm')) return next()

        const wasmFile = req.url.split('?')[0]
        const relative = wasmFile.startsWith('/') ? wasmFile.slice(1) : wasmFile
        const candidates = [
          path.resolve('node_modules', relative),
          path.resolve(relative),
        ]
        const filePath = candidates.find((p) => {
          try { fs.accessSync(p); return true } catch { return false }
        })
        if (!filePath) return next()

        res.setHeader('Content-Type', 'application/wasm')
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}
```

This plugin is only necessary during development. The production build uses static asset serving and is not affected.

---

## Browser Requirements

Fortemi is a browser-only application. All data processing and storage happens client-side.

### Persistence mode support

| Persistence mode | Storage backend | Minimum browser |
|-----------------|-----------------|-----------------|
| `opfs` | Origin Private File System | Chrome 113+, Edge 113+, Safari 17+ |
| `idb` | IndexedDB | Chrome 113+, Firefox 111+, Safari 17+ |
| `memory` | RAM (lost on refresh) | Any browser with WebAssembly support |

The `opfs` mode uses the OPFS Access Handle Pool API, which provides the best I/O performance and is recommended for production. Firefox does not support the synchronous OPFS variant that PGlite requires; use `idb` for Firefox users.

Safari 17+ supports OPFS but only stores data in memory when the page is not served from a persistent context. Safari 16 and earlier should use `idb`.

### Runtime detection

To select a persistence mode automatically based on the browser:

```typescript
async function selectPersistence(): Promise<'opfs' | 'idb'> {
  try {
    const root = await navigator.storage.getDirectory()
    // Check for synchronous OPFS support (required by PGlite)
    const testHandle = await root.getFileHandle('_opfs_test', { create: true })
    await (testHandle as { createSyncAccessHandle?(): Promise<unknown> }).createSyncAccessHandle?.()
    await root.removeEntry('_opfs_test')
    return 'opfs'
  } catch {
    return 'idb'
  }
}
```

### WebGPU requirement for LLM features

The local LLM capability (`llm`) requires WebGPU. WebGPU is available in:

- Chrome 113+
- Edge 113+
- Firefox 141+ (behind flag in earlier versions)
- Safari 18+

Semantic search (embeddings via `@huggingface/transformers`) uses WebAssembly SIMD and runs without WebGPU.

---

## WebGPU Setup on Linux

WebGPU is disabled by default in most Linux Chrome builds. For development machines and CI environments running headed browsers, enable it with the following flags:

```bash
google-chrome \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan,UseSkiaRenderer \
  --use-vulkan=native \
  --disable-vulkan-fallback-to-gl-for-testing
```

If Vulkan is not available (e.g., virtual machines, remote desktops, or CI runners without a GPU), Chrome falls back to SwiftShader, a software rasterizer. fortemi detects this via the GPU adapter's `architecture` field:

```typescript
// From packages/core/src/capabilities/gpu-detect.ts
if (arch === 'swiftshader' || vendor === 'google') {
  // SwiftShader detected — capabilities will be flagged accordingly
}
```

When SwiftShader is the only available adapter, the GPU detection code returns it with an `(software)` suffix on the architecture string. The LLM loader will still initialize, but will use `q4f32_1` quantization (instead of `q4f16_1`) because SwiftShader does not support the `shader-f16` feature. Performance will be significantly degraded relative to native GPU.

### Checking WebGPU status

To verify WebGPU is available in a running browser session, open the DevTools console and run:

```javascript
const adapter = await navigator.gpu?.requestAdapter()
console.log(adapter?.info)
// Expected on hardware GPU: { vendor: 'nvidia', architecture: 'turing', ... }
// Expected on SwiftShader:  { vendor: 'google', architecture: 'swiftshader', ... }
// null means WebGPU is unavailable
```

---

## Data Persistence

### Where data lives

All fortemi data is stored in the browser on the user's device. There is no server, no sync service, and no cloud backup. The storage location depends on the persistence mode:

| Mode | Location | Cleared by |
|------|----------|-----------|
| `opfs` | Origin Private File System, scoped to the page origin | "Clear site data" in browser settings, clearing browsing data with "Site data" checked |
| `idb` | IndexedDB, scoped to the page origin | "Clear site data", clearing "Cookies and other site data" |
| `memory` | Browser RAM | Page navigation, refresh, or tab close |

### Database naming

Each archive is stored in a separate database. The path is derived from the `archiveName` parameter passed to `FortemiProvider` or `createFortemi`:

- OPFS: `opfs-ahp://fortemi-{archiveName}`
- IndexedDB: `idb://fortemi-{archiveName}`

The default archive name is `default`. If you deploy multiple independent instances of the app on the same origin with different `archiveName` values, their databases are isolated from each other.

### Consequences of clearing browser data

Clearing "Site data" or "Cookies and other site data" in the browser will permanently delete all fortemi notes, tags, collections, attachments, and embeddings for your origin. There is no recovery mechanism. Inform users of this risk and provide an export mechanism (the archive export feature) before they clear browser data.

### Storage quota

Browsers impose per-origin storage quotas. The quota varies by browser and available disk space (typically 10-60% of available disk). Large model caches (see [Model Downloads](#model-downloads)) and many attachments can approach the quota. Use the Storage API to check:

```javascript
const estimate = await navigator.storage.estimate()
console.log(`Used: ${estimate.usage} / ${estimate.quota} bytes`)
```

---

## Model Downloads

### Transformers.js (semantic capability)

The `semantic` capability uses `@huggingface/transformers` to run the `all-MiniLM-L6-v2` embedding model (384-dimensional vectors). The model is approximately 23 MB and is downloaded from the Hugging Face CDN on first use.

After the first download, the model is cached in the browser's Cache Storage API. Subsequent page loads use the cached version and do not make network requests for the model.

### WebLLM models (LLM capability)

The `llm` capability uses `@mlc-ai/web-llm` to run a local language model via WebGPU. The model is selected automatically based on the detected VRAM tier:

| VRAM tier | Threshold | Model (f16) | Model (f32 / no shader-f16) | Download size |
|-----------|-----------|-------------|-------------------------------|---------------|
| `high` | > 2048 MB buffer | `Hermes-3-Llama-3.2-3B-q4f16_1-MLC` | `Hermes-3-Llama-3.2-3B-q4f32_1-MLC` | ~2-5.5 GB |
| `medium` | 256-2048 MB | `Qwen3-1.7B-q4f16_1-MLC` | `Qwen3-1.7B-q4f32_1-MLC` | ~1-2 GB |
| `low` / `unknown` | <= 256 MB | `Qwen3-0.6B-q4f16_1-MLC` | `Qwen3-0.6B-q4f32_1-MLC` | ~376 MB |

Model selection uses `maxBufferSize` from the WebGPU adapter limits as a proxy for VRAM capacity. The thresholds are conservative — a `maxBufferSize` of 2048 MB does not mean the device has 2 GB of VRAM, but it is a reliable indicator that larger models will run.

You can override automatic model selection by passing `modelOverride` to `registerLlmCapability`:

```typescript
import { registerLlmCapability } from '@fortemi/core'

registerLlmCapability(capabilityManager, completeFn, {
  modelOverride: 'Qwen3-0.6B-q4f32_1-MLC',
})
```

### What to tell users

Before enabling the LLM capability, inform users that:

- The model download is between 376 MB and 5.5 GB depending on their device
- The download happens once and is cached locally
- Clearing browser data will delete the cached model, requiring another download
- The model runs entirely on their device — no data is sent to any server
- A progress indicator will be shown during the download

If the download is interrupted, WebLLM's cache is partial and the model will not load. The user must clear the site data and allow the download to complete in a single session. Alternatively, you can expose a "Re-download model" button that calls `capabilityManager.enable('llm')` again after clearing the cache.

---

## CI/CD

### Gitea Actions pipeline

The repository includes a Gitea Actions workflow at `.gitea/workflows/ci.yml`. The pipeline runs on every push to any branch and on pull requests targeting `main`.

Jobs run in the order: `typecheck` and `lint` and `unit-test` in parallel, then `build` (which depends on all three passing).

```
typecheck ─┐
lint       ─┼─ build
unit-test  ─┘
```

All jobs use Node.js 22 and restore the pnpm store from cache before installing dependencies.

### Running the pipeline locally

To replicate the CI steps locally:

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Typecheck (all packages)
pnpm typecheck

# Lint
pnpm lint

# Unit tests (packages/core)
pnpm test:core

# Build
pnpm build
```

### Unit test parallelism

The unit tests in `packages/core` spin up a PGlite instance per test file. Each instance loads the WASM binary (~300 MB) and runs a full PostgreSQL process. Running too many in parallel saturates CPU and can cause OOM in constrained CI environments.

Worker count defaults to half the available CPU cores with a minimum of 2. Override it with the `VITEST_MAX_WORKERS` environment variable:

```bash
# Run with at most 2 parallel workers (recommended for CI runners with 4 vCPUs)
VITEST_MAX_WORKERS=2 pnpm test:core

# Run with maximum parallelism (for development machines with many cores)
VITEST_MAX_WORKERS=8 pnpm test:core
```

The Gitea Actions workflow does not set `VITEST_MAX_WORKERS`, so it uses the default (half the runner's CPU count). If unit tests are timing out or the runner runs out of memory, add the variable to the `unit-test` job's `env` block.

### End-to-end tests

E2E tests use Playwright and are not part of the default CI pipeline. They require a headed or headless Chromium/Firefox installation:

```bash
# Install browser binaries (run once)
cd apps/standalone
pnpm test:e2e:install

# Run E2E tests
pnpm test:e2e
```

E2E tests are intentionally excluded from the automated pipeline because they require real browser WASM execution and take several minutes. Run them manually before releases or in a dedicated nightly job.

---

## Monitoring

Fortemi is a client-side application with no server-side components to monitor. Observability is achieved by subscribing to the typed event bus.

### Event bus

The `TypedEventBus` in `@fortemi/core` emits structured events for all significant state changes. Events are available via exact subscriptions or wildcard prefix patterns.

Full event map:

| Event | Payload | Meaning |
|-------|---------|---------|
| `note.created` | `{ id: string }` | A note was created |
| `note.updated` | `{ id: string }` | A note was updated |
| `note.deleted` | `{ id: string }` | A note was soft-deleted |
| `note.restored` | `{ id: string }` | A deleted note was restored |
| `note.revised` | `{ id: string; revisionNumber: number }` | An AI revision was applied |
| `search.reindexed` | `{}` | The search index was rebuilt |
| `embedding.ready` | `{ noteId: string }` | An embedding was generated for a note |
| `capability.loading` | `{ name: string; progress?: number }` | A capability is loading (progress 0-100, or -1 for a text message) |
| `capability.ready` | `{ name: string }` | A capability finished loading |
| `capability.disabled` | `{ name: string }` | A capability was disabled |
| `job.completed` | `{ id: string; noteId: string; type: string }` | A background job completed |
| `job.failed` | `{ id: string; noteId: string; type: string; error: string }` | A background job exhausted retries |
| `archive.switched` | `{ name: string }` | The active archive was changed |
| `migration.applied` | `{ version: number }` | A schema migration was applied |

To subscribe from application code:

```typescript
import { useFortemiContext } from '@fortemi/react'

function DebugMonitor() {
  const { events } = useFortemiContext()

  useEffect(() => {
    // Wildcard: catch all note events
    const sub = events.on('note.*', (payload) => {
      console.log('[fortemi] note event', payload)
    })

    const jobFailed = events.on('job.failed', ({ id, type, error }) => {
      console.error(`[fortemi] job ${type} (${id}) failed: ${error}`)
      // Forward to your error tracking service here
    })

    return () => {
      sub.dispose()
      jobFailed.dispose()
    }
  }, [events])

  return null
}
```

### Job queue status

Query the job queue directly from the PGlite instance using `getJobQueueStatus` from `@fortemi/core`:

```typescript
import { getJobQueueStatus } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

async function logQueueStatus() {
  const { db } = useFortemiContext()
  const jobs = await getJobQueueStatus(db)

  const pending  = jobs.filter(j => j.status === 'pending').length
  const running  = jobs.filter(j => j.status === 'processing').length
  const failed   = jobs.filter(j => j.status === 'failed').length

  console.log(`Queue: ${pending} pending, ${running} running, ${failed} failed`)
}
```

Job types and their default priorities:

| Job type | Priority | Required capability |
|----------|----------|---------------------|
| `title_generation` | 2 (highest) | none (uses LLM if available, falls back to first-line extraction) |
| `linking` | 3 | none (skips if no embeddings exist) |
| `embedding` | 5 | `semantic` |
| `concept_tagging` | 5 | `llm` |
| `ai_revision` | 8 (lowest) | `llm` |

Jobs blocked on a capability that is not `ready` are skipped during each poll cycle and retried on the next poll (every 5 seconds by default). They are not counted as failures.

### Capability states

Capabilities follow a strict state machine: `unloaded` → `loading` → `ready` or `error`, with `disabled` reachable from `ready`. Poll state via `CapabilityManager.listAll()`:

```typescript
const { capabilityManager } = useFortemiContext()
const states = capabilityManager.listAll()
// [{ name: 'semantic', state: 'ready' }, { name: 'llm', state: 'unloaded' }, ...]
```

Subscribe to `capability.*` events for real-time state changes.

### Error forwarding

`job.failed` events include the error message string. Forward these to your error tracking service (Sentry, Datadog, etc.) by subscribing in a top-level component or in an app-level `useEffect`.

---

## Versioning

Fortemi packages use CalVer with the format `YYYY.M.PATCH`:

- `YYYY` — four-digit year (e.g., `2026`)
- `M` — one or two digit month, no leading zero (e.g., `3` not `03`)
- `PATCH` — zero-based patch number, no leading zero (e.g., `0`, `1`, `12`)

Examples of valid version strings: `2026.3.0`, `2026.11.4`, `2027.1.0`.

Examples of invalid version strings: `2026.03.0` (leading zero in month), `2026.3.00` (leading zero in patch). npm rejects packages with leading zeros in version components — users can install but cannot update.

Git tags use a `v` prefix: `v2026.3.0`.

All packages in the monorepo are versioned together. When cutting a release, update `version` in all three `package.json` files (`packages/core`, `packages/react`, `apps/standalone`) to the same version string before tagging.

---

## Troubleshooting

### WebGPU not available

**Symptom:** The `llm` capability transitions to `error` state immediately. `capabilityManager.getError('llm')` returns a message containing "WebGPU is not available".

**Cause:** The browser does not expose `navigator.gpu`, or `requestAdapter()` returned `null`.

**Resolution:**
- On Linux, launch Chrome with `--enable-unsafe-webgpu --enable-features=Vulkan` (see [WebGPU Setup on Linux](#webgpu-setup-on-linux)).
- On Windows and macOS, update to Chrome 113+ or Edge 113+.
- If the device has no GPU, SwiftShader will be used. The LLM will load but will be very slow.
- If WebGPU cannot be made available, disable the `llm` capability and inform the user. Semantic search (`semantic`) does not require WebGPU and will continue to work.

### PGlite fails to initialize

**Symptom:** `FortemiProvider` throws during mount. The error message contains "SharedArrayBuffer is not defined" or "COOP/COEP".

**Cause:** The page is not served with the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers.

**Resolution:** Verify that both headers are present in the server response. In Chrome DevTools, open the Network tab, click the document request, and check the Response Headers section. Both headers must be present with the values `same-origin` and `require-corp` respectively. See [Static Hosting](#static-hosting) for host-specific configuration.

**Symptom:** `FortemiProvider` throws with "QuotaExceededError" or "StorageError".

**Cause:** The browser has exhausted the storage quota for the origin, or the user has blocked storage access for the site.

**Resolution:** Check `navigator.storage.estimate()` to see current usage versus quota. If quota is exceeded, clear old archives or prompt the user to free space. If storage is blocked, the user must grant storage permission in browser settings.

**Symptom:** The app loads but data from a previous session is missing.

**Cause:** The persistence mode is set to `memory`, or the user cleared browser data.

**Resolution:** Confirm the `persistence` prop is `'opfs'` or `'idb'`. Confirm the `archiveName` matches what was used in previous sessions — a different name will open a new empty database rather than the existing one.

### Model download interrupted

**Symptom:** The `llm` or `semantic` capability enters `error` state with a message like "Failed to fetch" or "NetworkError" during the initial load.

**Cause:** The model download was interrupted before completing. WebLLM and transformers.js write model shards to Cache Storage. A partial cache may cause subsequent load attempts to fail.

**Resolution:**
1. Open DevTools, go to Application > Storage, and clear Cache Storage for the origin.
2. Reload the page and allow the download to complete in a single session.
3. If the user is on a metered or slow connection, advise them to keep the tab active until the progress indicator reaches 100%.

### Stale jobs in the queue

**Symptom:** Jobs are stuck in `processing` status after a page reload. The `[JobQueue] Recovered N stale jobs` log message appears on startup.

**Cause:** The app was closed or the tab was killed while jobs were running. In-progress jobs were not completed and their status was not updated.

**Resolution:** This is handled automatically. On startup, `JobQueueWorker.start()` calls `recoverStaleJobs()`, which resets all `processing` jobs to `pending`. They will be picked up on the next poll cycle (within 5 seconds). No manual intervention is required.

**Symptom:** Jobs accumulate in `failed` status and do not retry.

**Cause:** Jobs that have exhausted their retry count (`max_retries = 3` by default) are marked `failed` and are not retried automatically.

**Resolution:** Investigate the `error` field on the failed jobs using `getJobQueueStatus(db)`. Common causes:
- `llm` jobs failing because the LLM capability is in `error` state — fix the WebGPU issue first, then re-enable the capability.
- `embedding` jobs failing because the `semantic` capability was never enabled — enable it before creating notes.
- Content not found errors — the note may have been deleted before the job ran.

To manually requeue a failed job, update its status directly:

```typescript
await db.query(
  `UPDATE job_queue SET status = 'pending', retry_count = 0 WHERE id = $1`,
  [jobId]
)
```
