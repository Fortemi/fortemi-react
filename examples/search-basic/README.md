# EX-07 · search-basic

Full-text search running entirely in the browser: **Postgres FTS over PGlite**,
with ranked hits, highlighted snippets, tag facets, and prefix suggestions drawn
from the corpus vocabulary. Lexical only — **no embedding model is downloaded**.

```bash
pnpm install     # once, from the repo root
cd examples/search-basic
pnpm dev
```

## What it shows

- `useSearch()` in `mode: 'text'` — guaranteed lexical: it never reaches for a
  semantic model, so the demo stays download-free and instant.
- `useSearchSuggestions(history)` — prefix completions from the corpus
  vocabulary (`ts_stat`) plus your recent queries.
- Postgres `ts_headline` snippets (the `<b>…</b>` highlight markup) and
  `include_facets` tag counts.
- The `semantic_available` flag surfaced in the UI, so it's obvious when you're
  in lexical vs hybrid mode.

## Going hybrid

To blend in vector recall, enable the `semantic` capability (see the
capabilities examples — it downloads a transformers.js embedding model on
explicit opt-in), embed your notes, then switch this example to `mode: 'auto'`.
Search will use embeddings when they're ready and fall back to lexical when they
aren't.

## Copy it out

The app imports only `@fortemi/react` and `@fortemi/examples-shared`. The snippet
HTML comes from trusted seed content here; if you render user-supplied notes,
sanitize the `ts_headline` output before `dangerouslySetInnerHTML`. The
`vite.config.ts` uses the shared `@fortemi/examples-shared/vite-db` PGlite wiring
— inline it when you lift the example out.
