# ADR-005: Browser Compatibility Matrix

**Date**: 2026-03-20
**Status**: Accepted (Amended 2026-03-22 — Errata #1, #5)
**Deciders**: roctinam

---

## Context

fortemi-react depends on several modern browser APIs:
- **OPFS** (`navigator.storage.getDirectory()`) — for PGlite persistence and blob storage
- **OPFS synchronous access** (`createSyncAccessHandle()`) — required by PGlite in a Worker context
- **Service Worker** — for REST API interception
- **Web Workers** — for PGlite single-writer worker and job queue
- **WebAssembly** — for PGlite, transformers.js, WebLLM, Whisper.js

> **Errata (2026-03-22):** PGlite 0.4.1 uses OPFS sync access handles, NOT SharedArrayBuffer. COOP/COEP headers are not required for PGlite persistence. Safari caps OPFS sync access handles at 252, but PostgreSQL opens 300+ files — making OPFS persistence non-functional on Safari.

## Decision

**Supported browsers (v1):**

| Browser | Platform | Min Version | Persistence | Notes |
|---|---|---|---|---|
| Chrome / Chromium | Mac, Windows, Linux | 102+ | OPFS (`opfs-ahp://`) | Full support. Primary target. |
| Edge | Windows, Mac | 102+ | OPFS (`opfs-ahp://`) | Chromium-based, same as Chrome |
| Firefox | Mac, Windows, Linux | 111+ | IndexedDB (`idb://`) | OPFS AHP not supported; `idb://` adapter works |
| Safari | macOS | 17.0+ | In-memory only | OPFS sync access handle limit (252) below PGlite minimum (~300). Data does not persist across sessions. |
| Safari | iOS | **Not supported v1** | None | WebKit OPFS sync unreliable; iOS forces WebKit on all browsers |

**Browser-specific persistence matrix (PGlite 0.4.1):**

| Filesystem Adapter | Chrome | Firefox | Safari |
|---|---|---|---|
| In-memory (`new PGlite()`) | Yes | Yes | Yes |
| OPFS AHP (`opfs-ahp://`) | Yes | **No** | **No** |
| IndexedDB (`idb://`) | Yes | Yes | **No** |

**Browser detection strategy:**
- Detect browser at app startup; select persistence adapter accordingly
- Chrome/Chromium/Edge: use `opfs-ahp://` (best performance)
- Firefox: use `idb://` (functional, slightly slower)
- Safari: use in-memory with clear warning that data will not persist across sessions
- Show browser-specific guidance if persistent storage is unavailable

## COOP/COEP Headers

> **Errata (2026-03-22):** PGlite 0.4.1 does NOT require SharedArrayBuffer. COOP/COEP headers are **not required** by default and may cause problems by blocking third-party resources (fonts, CDN scripts).

Do NOT set these headers unless a specific feature requires them (e.g., `performance.measureUserAgentSpecificMemory()`). Verify during PoC.

## Consequences

**Positive:**
- Chrome/Edge users get full persistent storage via OPFS
- Firefox users get persistent storage via IndexedDB adapter
- No COOP/COEP headers required — simpler hosting setup (GitHub Pages, static hosts work out-of-box)
- >90% of desktop browser users are on Chrome/Edge/Firefox with full persistence

**Negative:**
- Safari users limited to in-memory mode — no data persistence across sessions
- iOS users cannot use fortemi-react v1 (Apple forces WebKit on iOS)
- Firefox persistence (IndexedDB) may be slower than Chrome's OPFS for large databases
- Must implement browser-specific adapter selection logic
