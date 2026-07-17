---
title: Welcome
summary: The browser edition of the Fortémi intelligent-database stack — a normalized PGlite data layer with profile-scoped Knowledge Shard portability, hybrid semantic search, SKOS tagging, and graph tooling. Local-first and private-by-default.
hero:
  eyebrow: Fortémi React
  title: The Fortémi Intelligent Database, in the Browser
  subtitle: The browser edition of the Fortémi intelligent-database stack — a PGlite (PostgreSQL WASM) data layer running the same normalized schema, hybrid semantic search, W3C SKOS tagging, and graph tooling. No server required. Local-first, private-by-default.
  fullBleed: true
  align: center
  cta:
    - { label: "Get started", href: "#getting-started", style: primary }
    - { label: "API Reference", href: "#api-reference", style: ghost }
banner:
  title: Ready to embed a knowledge archive?
  text: Wrap your app in FortemiProvider and load notes three ways — an in-browser database, plain files, or a ready-made snapshot.
  fullBleed: true
  cta:
    - { label: "Browse packages", href: "#packages/core", style: primary }
    - { label: "What's new", href: "/blog", style: ghost }
---

# Overview

## What is fortemi-react?

Fortémi is an intelligent database for AI-ready applications: a normalized data schema plus data-science and processing tooling that turns messy organizational data into searchable, linkable, provenance-aware structures. The same schema runs across the server, browser edition, and HotM sidecar, giving teams a common substrate for complex, data-rich, compute-heavy applications while keeping deployment affordable on local, edge, or hosted infrastructure.

fortemi-react is the **browser edition of that stack**. It runs the same normalized schema with **no separate server** — the data lives in the browser on the user's device, search runs locally, and any cloud or AI provider is strictly opt-in. Keeping notes for an AI agent and searching them by *meaning*, not just exact words, is a use case built on that substrate — not the whole product.

It is the stack *in the browser*. (HotM, a separate project, is a desktop client that bundles the Rust server; fortemi-react is the stack itself, ported to run in-page.) Knowledge Shard exchange is governed by named compatibility profiles and cross-repository conformance tests; repository and API shapes outside a selected profile are not implied to be identical.

## Fortémi (product) vs `@fortemi/core` (embeddable library)

`@fortemi/core` is an embeddable library — the headless data layer other tools build on. (For example, it is AIWG's default index and discovery backend, reading from a static local cache.) A tool that embeds `@fortemi/core` is **not running Fortémi**: it is using the library's schema and query surface inside its own process, and the library ships no data anywhere by default. Fortémi the product is the full stack — the server or this browser edition — with its job pipeline, capability system, and portable archives.

## Highlights

- **Runs fully in-browser** — a real PostgreSQL data layer via PGlite (PostgreSQL compiled to WebAssembly) with pgvector. No backend to stand up.
- **Hybrid search** — full-text and semantic (meaning-based) retrieval, fused with rank fusion, running off the main thread so the page never freezes.
- **Three ways to load notes** — an in-browser database, plain files with no database, or a ready-made snapshot that starts fast. One shared design picks the best source for what you asked.
- **Local-first, private-by-default** — your notes stay on the device; nothing leaves it unless you choose a remote or cloud provider.
- **Profile-scoped portability** — Knowledge Shards validate before import and move between supported consumers only for their declared, conformance-tested profile.

## Three ways to load your notes

fortemi-react reads your notes through **one shared contract**, no matter where they live. A "picker" chooses the source that fully answers your request with the least startup cost:

| Source | What it is | Best for |
|--------|-----------|----------|
| **In-browser database** | A full PGlite database with pgvector | Ranked search and vectors on read/write archives |
| **Canonical records** | A lightweight writable record store — no database | Read/write note-taking with instant startup |
| **Plain files** | A knowledge pack read in place as static files — no database | Read-only reference sets on any static host |
| **Snapshot** | A database with its search index *already built in* | Fast startup on large sets |

Same code, your choice, no rewrite. Small sets can read *and write* with no database at all; the full database layers in ranked full-text and semantic search when you need it — and it can be rebuilt from the canonical records at any time.

## How it differs from typical browser storage

| Aspect | Typical browser storage | fortemi-react |
|--------|------------------------|---------------|
| **Store** | `localStorage` / IndexedDB blobs | PGlite — a real PostgreSQL engine with pgvector |
| **Search** | Substring match | Hybrid full-text + semantic, fused with RRF |
| **Server** | Needed for real search | None — everything runs in the page |
| **AI / cloud** | Baked in | Opt-in, private-by-default |
| **Portability** | App-specific | Knowledge Shards with named, conformance-tested profiles |
| **Load modes** | One | Three — database, plain files, or snapshot |

## The packages

fortemi-react is a small monorepo of three published packages, in a linear dependency chain:

- **`@fortemi/core`** — the headless, browser-only data layer: PGlite, a single-writer worker, MCP tools, a job queue, and hybrid search. No React.
- **`@fortemi/graph`** — framework-agnostic community-graph tooling: layout, filtering, neighborhood expansion, and snapshot serialization. Depends on core; no React.
- **`@fortemi/react`** — React 19 hooks and `FortemiProvider` over `@fortemi/core`, with a `GraphView` built on `@fortemi/graph`.

A plain JavaScript app can use `@fortemi/core` and `@fortemi/graph` with no React at all.

## Where to go next

- **[Getting Started](#getting-started)** — install the packages and wrap your app in `FortemiProvider`.
- **[Integration](#guides/integration)** — add fortemi-react to an existing React app.
- **[API Reference](#api-reference)** — every hook, provider, and core API.
- **[Packages](#packages/core)** — per-package reference for core, graph, and react.
- **[Extending](#advanced/extending)** — add custom capabilities and deploy.
- **[Blog](/blog)** — monthly release reports and what's new.
