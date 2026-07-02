---
title: Welcome
summary: A browser-only port of the Fortémi memory server — PGlite data layer, hybrid semantic search, SKOS tagging, and graph tooling, with 100% JSON format parity with the Rust server. Local-first and private-by-default.
hero:
  eyebrow: Fortémi React
  title: Knowledge Management in the Browser
  subtitle: The Fortémi memory server, running entirely in the browser — a PGlite (PostgreSQL WASM) data layer, hybrid semantic search, W3C SKOS tagging, and graph tooling. No server required. Local-first, private-by-default.
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

fortemi-react is the **browser build of the Fortémi memory server**. Fortémi keeps notes for an AI agent and lets the agent search them by *meaning*, not just exact words. fortemi-react does that same job with **no separate server** — the data lives in the browser on the user's device, search runs locally, and any cloud or AI provider is strictly opt-in.

It is the server *in the browser*. (HotM, a separate project, is a desktop client that talks to the Rust server; fortemi-react is the server itself, ported to run in-page.) Its JSON output matches the Fortémi Rust server exactly, so archives are portable between the two.

## Highlights

- **Runs fully in-browser** — a real PostgreSQL data layer via PGlite (PostgreSQL compiled to WebAssembly) with pgvector. No backend to stand up.
- **Hybrid search** — full-text and semantic (meaning-based) retrieval, fused with rank fusion, running off the main thread so the page never freezes.
- **Three ways to load notes** — an in-browser database, plain files with no database, or a ready-made snapshot that starts fast. One shared design picks the best source for what you asked.
- **Local-first, private-by-default** — your notes stay on the device; nothing leaves it unless you choose a remote or cloud provider.
- **Format parity** — 100% JSON parity with the Fortémi Rust server, so Knowledge Shards move cleanly between browser and server.

## Three ways to load your notes

fortemi-react reads your notes through **one shared contract**, no matter where they live. A "picker" chooses the source that fully answers your request with the least startup cost:

| Source | What it is | Best for |
|--------|-----------|----------|
| **In-browser database** | A full PGlite database with pgvector | Read/write archives; the default |
| **Plain files** | A knowledge pack read in place as static files — no database | Read-only reference sets on any static host |
| **Snapshot** | A database with its search index *already built in* | Fast startup on large sets |

Same code, your choice, no rewrite. Small sets can run with no database at all; big sets can use the full database.

## How it differs from typical browser storage

| Aspect | Typical browser storage | fortemi-react |
|--------|------------------------|---------------|
| **Store** | `localStorage` / IndexedDB blobs | PGlite — a real PostgreSQL engine with pgvector |
| **Search** | Substring match | Hybrid full-text + semantic, fused with RRF |
| **Server** | Needed for real search | None — everything runs in the page |
| **AI / cloud** | Baked in | Opt-in, private-by-default |
| **Portability** | App-specific | Knowledge Shards, JSON parity with the Fortémi server |
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
