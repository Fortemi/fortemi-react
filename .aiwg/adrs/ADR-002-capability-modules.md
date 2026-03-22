# ADR-002: Opt-in Capability Module System

**Date**: 2026-03-20
**Status**: Accepted
**Deciders**: roctinam

---

## Context

fortemi-browser supports multiple WASM capability tiers:
- Semantic search: transformers.js `nomic-embed-text` (~100MB)
- AI revision: WebLLM (~1-4GB) or external LLM API
- Audio transcription: Whisper.js (~100MB) or external API
- Vision: WebLLM vision (~2GB) or external API
- PDF/Office extraction: pdf.js + mammoth.js + SheetJS (~5MB)

Bundling all of these would force every user to download 3-7GB. Most users need only a subset.

Additionally, WASM models must be loaded **before** any code that depends on them can run, and **after** the capability flag system is established — otherwise a module could be bundled into the main entry point and downloaded unconditionally.

## Decision

Implement a **Capability Module System** with:
1. Feature flags per capability (`semantic`, `llm`, `audio`, `vision`, `pdf`)
2. A `CapabilityManager` that handles loading, caching, and lifecycle
3. All capability modules loaded **lazily on demand**, never eagerly
4. The capability system itself is Phase 1 infrastructure — no WASM code is written until this system exists
5. Job queue entries include a `required_capability` field; jobs stay `pending` until their capability is `ready`

## Decision Rule

> The capability module system **must be built and tested before any WASM integration code is written**. Violating this order will result in unconditional WASM downloads for all users.

## Module Specifications

| Capability | Flag | WASM source | Size | Fallback |
|---|---|---|---|---|
| Semantic | `semantic` | transformers.js (CDN) | ~100MB | BM25-only search |
| LLM | `llm` | WebLLM OR external API key | ~1-4GB or 0MB | Store original as-is |
| Audio | `audio` | Whisper.js OR external API | ~100MB or 0MB | No transcription |
| Vision | `vision` | WebLLM vision OR external API | ~2GB or 0MB | No image description |
| PDF | `pdf` | pdf.js + mammoth.js + SheetJS | ~5MB | Store blob, no text |

## Consequences

**Positive:**
- Text-only user downloads <5MB of JS; no WASM at all
- Each capability independently activatable/deactivatable
- Graceful degradation is built into the system, not bolted on
- Jobs waiting for a capability auto-resume when it becomes ready

**Negative:**
- Module loading UX (progress, errors) must be built
- Job queue must be capability-aware (filter eligible jobs by ready capabilities)
- External API paths (OpenAI, Ollama proxy) require configuration UI and secret storage
