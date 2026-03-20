# ADR-004: Service Worker REST API Interception

**Date**: 2026-03-20
**Status**: Accepted
**Deciders**: roctinam

---

## Context

MCP tools, AI agents (Claude, Cursor), and external integrations target the fortemi server's REST API at `http://localhost:3000`. For fortemi-browser to be a drop-in replacement, those same HTTP calls must work unchanged against the browser backend.

Options:
1. **Service Worker interception** — intercept `fetch()` to `localhost:3000`, serve from PGlite
2. **In-page HTTP server** — embed a fake HTTP server in the page
3. **Electron/Tauri** — native wrapper to run a real HTTP server
4. **Require API clients to import a JS SDK** — breaking change, not compatible

## Decision

Use a **Service Worker** to intercept all `fetch()` calls to `http://localhost:3000/api/*`. The SW handles routing, request parsing, delegation to the API layer, and response serialization.

**Why Service Worker over alternatives:**
- Transparent to callers — no changes required in MCP clients or agent tools
- Works in standard browser (no native wrapper needed)
- SW has access to the same origin storage (can communicate with PGlite Worker via SharedWorker or BroadcastChannel)
- SW lifecycle is well-defined (install, activate, fetch)

**Browser compatibility:** Chrome 102+, Firefox 111+, Safari 17+ (see ADR-005).

## SW Architecture

```
fetch(localhost:3000/api/v1/notes)
        ↓
Service Worker (fetch event)
        ↓
Router (match method + path)
        ↓
Handler (parse body, validate)
        ↓
Repository (PGlite Worker via postMessage)
        ↓
Response (JSON, exact server format)
```

## SW Versioning & Update Safety

SW updates must not interrupt in-flight requests or cause data loss:
1. New SW version installs alongside old one
2. `skipWaiting()` called only after all active tabs have no pending requests
3. On activate, call `clients.claim()` to take control
4. DB migrations run on first connection to new schema version — never in SW install

## Consequences

**Positive:**
- Zero changes required in MCP clients — plug-and-play compatibility
- Full HTTP semantics (status codes, headers, CORS) preserved
- Can be tested with standard HTTP clients (curl, Postman, fetch)

**Negative:**
- SW requires HTTPS or localhost — standard PWA constraint, acceptable
- SW update lifecycle requires care (handled by versioning strategy above)
- Safari 17+ minimum for OPFS sync (SW itself works in Safari 16.4+; PGlite in Worker requires Safari 17+)
- Cannot intercept requests from other origins (security by design — not a limitation for our use case)
