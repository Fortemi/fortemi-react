# EX-20: Knowledge workspace

A complete, production-shaped Fortemi application derived from the live
`magly.net/fortemi` implementation. It demonstrates Fortemi as an application
data primitive rather than a graph widget.

## What it includes

- shard-backed browsing and full-text search without starting a database
- an opt-in PGlite worker for writes and semantic search
- summary-level and full-content vector search
- local note capture with deferred title, summary, concept, embedding, and link jobs
- SKOS concept metadata and W3C PROV revision history
- local WebGPU or remote OpenAI-compatible language model setup
- optional citation/topic exploration in 2D and 3D
- responsive Fortemi light and dark themes

The bundled corpus and graph snapshots are the same demonstration dataset used
by the Magly implementation. User-authored notes stay in the browser.

```bash
pnpm install
pnpm --filter @fortemi/example-knowledge-workspace dev
```

Open the URL printed by Vite. Model downloads and remote provider calls happen
only after an explicit user action.
