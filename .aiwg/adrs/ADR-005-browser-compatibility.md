# ADR-005: Browser Compatibility Matrix

**Date**: 2026-03-20
**Status**: Accepted
**Deciders**: roctinam

---

## Context

fortemi-browser depends on several modern browser APIs:
- **OPFS** (`navigator.storage.getDirectory()`) — for PGlite persistence and blob storage
- **OPFS synchronous access** (`createSyncAccessHandle()`) — required by PGlite in a Worker context
- **SharedArrayBuffer** — required for synchronous OPFS in Worker (needs COOP/COEP headers)
- **Service Worker** — for REST API interception
- **Web Workers** — for PGlite single-writer worker and job queue
- **WebAssembly** — for PGlite, transformers.js, WebLLM, Whisper.js

## Decision

**Supported browsers (v1):**

| Browser | Platform | Min Version | Notes |
|---|---|---|---|
| Chrome / Chromium | Mac, Windows, Linux | 102+ | Full support. Best tested PGlite target. |
| Firefox | Mac, Windows, Linux | 111+ | Full support. |
| Edge | Windows, Mac | 102+ | Chromium-based, same as Chrome |
| Safari | macOS | 17.0+ | OPFS sync API stable from 17.0 |
| Safari | iOS | **Not supported v1** | WebKit OPFS sync unreliable; iOS forces WebKit on all browsers |
| Chrome / Firefox | macOS | Any current | Mac users on Chrome/Firefox have no issues even if Safari is unavailable |

**Browser detection strategy:**
- Detect OPFS sync support at app startup
- If unsupported: show clear message "Use Chrome 102+, Firefox 111+, or Safari 17+"
- Do NOT silently degrade to in-memory (data loss risk)

## COOP/COEP Headers Required

SharedArrayBuffer (needed for PGlite OPFS sync) requires:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For PWA deployment (static file server / GitHub Pages), these headers must be set. If the host cannot set headers, use `coi-serviceworker` shim as fallback.

## Consequences

**Positive:**
- Mac users on Chrome or Firefox work perfectly regardless of Safari version
- >95% of desktop browser users are on supported versions

**Negative:**
- iOS users cannot use fortemi-browser v1 (Apple forces WebKit on iOS regardless of browser label)
- Requires COOP/COEP headers — hosting setup must support custom response headers
- Safari 16.x users on Mac must upgrade or switch browser
