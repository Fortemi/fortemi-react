# Fortemi — standalone app

**A private, local-first knowledge app that runs entirely in your browser. Your notes stay on your device.**

Fortemi is a personal knowledge workspace: capture notes, search them instantly, organize with tags, collections, and links, and explore how everything connects in a relationship graph. It runs in your browser on top of a real PostgreSQL engine (PGlite) — there's no account to create, no server to trust, and no cloud sync. Your data stays on your device unless you explicitly choose to use a cloud AI provider.

This is the reference application for the `@fortemi/*` packages. Run it as-is for a complete local knowledge app, or use it as the starting point for your own.

## Why you might want this

- **Your data, your device.** Notes live locally in your browser. No server, no account, no cloud backup — clearing your browser's site data is the only thing that removes them.
- **Capable, not a toy.** A full PostgreSQL engine in the browser means real full-text search, semantic (vector) search, tags, collections, links, and a relationship graph — and it stays fast as your archive grows.
- **AI is optional and yours.** Embeddings and LLM features are opt-in. Run them locally (WebGPU in the browser, or Ollama / LM Studio / llama.cpp / vLLM / Jan on your machine) or point at a provider you control. Nothing is sent anywhere unless you turn it on.
- **Take it with you.** Export your whole archive as a portable Knowledge Shard (a single `.tar.gz` with checksums) and import it elsewhere. AGPL-3.0 licensed — no lock-in.

## Run it locally

Requires **Node.js 22+** and **pnpm 10**.

```bash
pnpm install
pnpm dev        # http://localhost:5173  (alias for: pnpm --filter @fortemi/standalone dev)
```

## Build and self-host

It's a static site — there is no backend to run.

```bash
pnpm --filter @fortemi/standalone build     # → apps/standalone/dist/
pnpm --filter @fortemi/standalone preview    # preview the production build locally
```

Deploy `apps/standalone/dist/` to any static host — Netlify, Vercel, GitHub Pages, Cloudflare Pages, an S3 bucket, or your own machine. With no server component, you fully control where it runs and what it talks to.

## Browser support

| Browser | Storage | Notes |
|---|---|---|
| Chrome / Edge 113+ | OPFS (recommended) | WebGPU available for local AI when enabled; Linux Chrome may need flags |
| Firefox 111+ | IndexedDB | WASM embeddings work; WebGPU support is limited |
| Safari 17+ | Memory or IndexedDB | Use memory mode where persistence is restricted |

Your archive is stored in the browser profile you use, scoped to the site's origin — it isn't shared between browsers or devices (move it with a Knowledge Shard export/import).

## Building your own

This app is wired with `@fortemi/react` (provider + hooks), `@fortemi/core` (the headless PGlite data layer), and `@fortemi/graph` (relationship-graph rendering). To start your own local-first knowledge app:

```bash
pnpm add @fortemi/core @fortemi/react
```

See the workspace [README](../../README.md) and [Getting Started](../../docs/getting-started.md).

## License

AGPL-3.0-only. This is the private demo app in the fortemi-react workspace; it is not published to npm.
