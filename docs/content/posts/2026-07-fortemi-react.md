---
template: post
title: "Fortémi React — July 2026"
slug: "2026-07-fortemi-react"
date: 2026-07-31
author: Fortémi Team
summary: "July turned fortemi-react into a stronger browser edition of Fortémi: safer portable shards, richer graph views, a no-database record tier, AIWG index support, and a cleaner public release path."
hero: "https://docs.fortemi.com/react/assets/images/posts/2026-07/fortemi-react-july-2026-hero.png"
heroAlt: "Abstract browser knowledge graph connected to a portable shard package and a verification receipt."
tags: [report, fortemi-react, "2026-07", agent-memory]
status: published
---

## TL;DR

July made fortemi-react stronger as the browser edition of Fortémi. It can still run with the full browser database. It can also run with a lighter record store when a database is too much. Knowledge Shards got safer and clearer. The graph views became real tools, with live 2D, optional 3D, and drag support. Public npm publishing also moved to a cleaner path with proof attached to each package.

## By the numbers

| What's public | Value |
|---|---|
| Published packages | `@fortemi/core`, `@fortemi/graph`, `@fortemi/react` |
| Release series | `2026.7.x`, published on npm |
| Key capabilities | browser memory, Knowledge Shards, graph views, AIWG index search, React parts |
| Docs | docs.fortemi.com/react |
| Demo surface | demo.fortemi.com/react |

## Highlights

**1. A lighter writable memory path.**
What it is: fortemi-react now has a record store that can write notes without the browser database.
How you would use it: build a small local memory without loading the full database engine.
Why it helps: small apps can start faster and still save real work.

**2. Knowledge Shards became more honest.**
What it is: exported knowledge packs now say which shape they support.
How you would use it: move a pack between the browser and the Fortémi server, then check what made the trip.
Why it helps: export is no longer a vague promise. The pack tells you what it kept.

**3. Graph views became interactive.**
What it is: graph views gained live 2D, optional 3D, saved positions, and node dragging.
How you would use it: let a user move key notes, open a node, or switch to a richer graph view.
Why it helps: the graph becomes a work surface, not just a picture.

**4. AIWG indexes became first-class browser data.**
What it is: fortemi-react can read and search AIWG static indexes in the browser.
How you would use it: load a docs or tool index and search it without a server.
Why it helps: agent tool search can stay local.

**5. Untrusted files got stricter treatment.**
What it is: the shard and index readers now treat outside files as unsafe until they pass checks.
How you would use it: open a shard or index from a URL with stricter path, size, and privacy checks.
Why it helps: bad files fail safely.

**6. Public publishing became cleaner.**
What it is: npm publish now uses trusted publishing, and release keys are separate from commit keys.
How you would use it: install the public packages from npm with more trust in how they were made.
Why it helps: the package path is easier to audit.

## Features shipped

**AIWG search in the browser.** fortemi-react can read the newer AIWG static index shape. It keeps links and directions. It supports text search, meaning search, mixed search, and an automatic mode. It can also build graph views from index chunks without loading the whole export at once.

**Attachment-aware local memory.** Notes can carry attachment details and extracted text through search and export. Raw files stay in blob storage. The text and stable file links travel with the note. That makes attached documents easier to find.

**Safer shard and index loading.** July hardened files that come from outside the app. The readers now block unsafe paths, very large unpacked files, and bad shapes. Private or sensitive records are left out by default when builders make static indexes or embedding sets.

**No-database records.** The new record tier lets an app read and write notes without PGlite. PGlite is still there for richer database use. The lighter path is useful when a small local app does not need the full engine.

**Clearer shard profiles.** The package now says what each path can support. PGlite has one profile. The record store has another. Full-profile work is tied to receipts. If a pack cannot keep something, the import or export path says so instead of hiding the loss.

**Attachment bytes in shards.** Knowledge Shards can now carry file bytes as sidecars. The sidecar is named by its content hash, which is a stable ID made from the bytes. That makes it easier to check that a file is the same file after it moves.

**Better graph tiers.** `@fortemi/graph` added shared graph prep, saved positions, and pinned node support. `@fortemi/react` added optional 2D and 3D graph views. Heavy graph packages load only when a host asks for those views.

**Examples and demo gallery.** The examples program became a live demo gallery. It covers local AI setup, shard exchange, remote backend seams, docs maps, knowledge gardens, research workbenches, and a full knowledge workspace.

## Fixes

Several fixes focused on exact moves between storage paths. Old shard rows import more safely. The code now keeps the difference between missing, `null`, empty, and set values. Collection trees stay intact across memory, IndexedDB, record export, and PGlite. Shard output is also repeatable, so the same input makes the same bytes.

Graph and example fixes made the demos easier to use. The 2D graph no longer loops while drawing. Local discovery views settle better. Theme toggles work across examples. Dual-instance demos were repaired.

## Performance & reliability

The main reliability gain was choice. A host can use a static graph-only path, the no-database record tier, or the full PGlite path. That keeps heavy code out of small bundles. Search and graph paths also gained more checks tied to packed npm files, not just source code.

## Breaking changes & migrations

One type change matters. Current note content can be `null`. Code that reads `NoteRevisedCurrentRecord.content` should handle a missing current body.

There was also a privacy default change. Static index and embedding-set builders now leave out private or sensitive records unless the caller opts in. Existing indexes and shards still load.

## Releases

The public npm series for July includes:

- `2026.7.0` — AIWG index search and graph contracts.
- `2026.7.1` — support for the newer AIWG export shape.
- `2026.7.2` — attachment text and headless embedding-set builds.
- `2026.7.3` — safer loading for outside indexes and shards.
- `2026.7.4` — optional PGlite, 2D and 3D graphs, blob sidecars, docs sync, and trusted npm publish.
- `2026.7.5` — examples and demo gallery work.
- `2026.7.7` — legacy shard import and public npm dependency fixes.
- `2026.7.8` — writable records without a database and shard round-trips.
- `2026.7.9` — shard package boundary and separate release keys.
- `2026.7.10` — PGlite portability fixes.
- `2026.7.11` — collection tree parity and repeatable archives.
- `2026.7.12` — small vendorable AIWG index path.
- `2026.7.13` — schema 2 presence rules and AIWG full-profile conversion.
- `2026.7.14` — receipt-backed full-profile advertising.
- `2026.7.15` — supported-platform evidence.

## Dependencies & security

Security work was a major July theme. The browser package now treats portable files and indexes as untrusted input, not friendly local data. The release path also improved. npm publishing uses trusted publishing and proof checks. Release signing and commit signing use separate keys.

Dependencies were made more optional where possible. PGlite loads only when needed. Sigma and Three.js sit behind graph subpaths. Basic apps stay smaller. Rich graph views opt into their own cost.

## Docs & developer experience

The docs now say the core idea more clearly: fortemi-react is the browser edition of the Fortémi intelligent-database stack. API docs grew for Knowledge Shards, AIWG indexes, graph rendering, and React graph views. The demo gallery gives builders working examples.

## Tests & CI

July added more contract-style tests around shard import, shard export, platform support, examples, graph behavior, and package boundaries. The user-facing point is simple: release evidence now checks the packed npm files, not only the source tree.

## Cross-project impact

Fortémi server benefits from the shared Knowledge Shard work, especially profile names, attachment bytes, and receipt-backed checks. AIWG benefits from browser-side index search, graph traversal, and shard conversion. Pagenary and other static sites can use the graph-only subpath without pulling in the database engine.

## Known issues & open threads

Platform support is still profile-scoped. The published evidence does not claim that every backup, GUI path, operating system, and server path is complete. Windows coverage remains deferred. The remote-server source is still future work.

## What's next

The next work is to keep closing the gap between browser storage and server storage without overstating parity. Expect more receipt checks, more shard profile work, better examples, and more tuning for graph and local-memory paths.

## Appendix

- **Published packages:** `@fortemi/core`, `@fortemi/graph`, `@fortemi/react`.
- **Releases:** the `2026.7.x` series, published to npm through July.
- **Source / docs:** github.com/Fortemi/fortemi-react · docs.fortemi.com/react · window: all of July 2026.
