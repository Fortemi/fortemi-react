# EX-18 · research-workbench

A composed application: a small **research library** over one in-browser
`PGlite` database, wiring the attachment, concept, citation, and W3C PROV
provenance surfaces into a single workbench. No server, and nothing downloads — the
"extracted text" is the corpus body and concepts are assigned directly rather
than by an embedding pipeline.

```bash
pnpm install      # once, from the repo root
cd examples/research-workbench
pnpm dev
```

## What it composes

Seven papers across three areas (retrieval, reasoning, agents) are seeded once
(`src/seed.ts`) from a fixed spec (`src/corpus.ts`). Each paper becomes a note
with:

- **an attachment** — the full paper text, stored via `manageAttachments`
  (`action: 'attach'`) with the body passed as `extracted_text`. The detail pane
  lists it via `manageAttachments` (`action: 'list'`) and previews/expands the
  extracted text.
- **SKOS concept tags** — a `SkosRepository` scheme with one concept per area
  plus cross-cutting method concepts (`embeddings`, `tool-use`, `grounding`, …).
  `skos.tagNote` assigns them; the pane reads them back with **`useNoteConcepts`**.
- **citations** — directed `cites` links via `manageLinks` (`action: 'create'`),
  read back per paper with `manageLinks` (`action: 'list'`) into **Cites** /
  **Cited by** columns.
- **W3C PROV-style history** — `ProvenanceRepository.recordProvenance` writes
  note-scoped `provenance_edge` rows with `prov:entity`, `prov:wasDerivedFrom`,
  `prov:wasAssociatedWith`, source location, and confidence attributes. Citation
  links add their own derivation events, so the timeline distinguishes paper
  ingestion from relationship derivation.

The surface shares one selection across three panels:

- the **citation graph** — a `CommunityGraph` (communities = research areas) fed
  to `GraphView`; clicking a node focuses its citation neighbourhood via
  `filters={{ nodeIds }}`, and drives the same selection as the paper list;
- **`useNote`** — title, tags, and abstract for the selected paper;
- **`useNoteProvenance`** — the note's stored PROV edges plus creation, jobs,
  and edits. The **Add revision** button calls **`useUpdateNote`**, which writes
  a new note revision; the pane remounts so the provenance timeline shows both
  seeded source lineage and the fresh `User edit (revision #N)` event.

## Why it downloads nothing

Concept tagging and AI revision are normally driven by the job pipeline, which
needs an embedding/LLM capability (see `local-ai-setup`, the one example that
downloads). This workbench assigns concepts and attaches text **directly**, so
it exercises every read surface — attachments, concepts, citations, PROV
provenance — with an instant, disposable `persistence="memory"` database and zero network.
The `@fortemi/react` root barrel pulls the PGlite worker into the bundle, but it
runs entirely in-tab.

## Copying this out

Replace `src/corpus.ts` with your own documents. To attach *real* extracted
text, run your PDF/HTML extractor and pass the result as `extracted_text`; to
generate concepts and provenance automatically, enable the `semantic` capability
(as in `local-ai-setup`) and let the job pipeline tag and revise. The
composition — one selection over graph, detail, attachments, concepts, and
provenance — is unchanged.

## Packages used

- [`@fortemi/react`](../../packages/react) — `useNote`, `useNoteConcepts`,
  `useNoteProvenance`, `useUpdateNote`, `useFortemiContext`, `FortemiProvider`
- [`@fortemi/react/graph`](../../packages/react) — `GraphView`
- [`@fortemi/core`](../../packages/core) — `NotesRepository`,
  `ProvenanceRepository`, `SkosRepository`, `manageAttachments`, `manageLinks`
- [`@fortemi/graph`](../../packages/graph) — `CommunityGraph` (graph types)
- [`@fortemi/examples-shared`](../_shared) — the PGlite/Vite wiring (dev only)
