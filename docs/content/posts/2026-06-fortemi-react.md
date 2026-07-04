---
template: post
title: "Fortémi React — June 2026"
date: 2026-06-01
author: Fortémi Team
summary: "The Fortemi memory server now runs in your browser three ways — from a database, from plain files with no database, and from a ready-made snapshot — plus a new graph package and a docs site."
tags: [report, fortemi-react, "2026-06", agent-memory]
hero: "https://docs.fortemi.com/react/assets/images/posts/2026-06/fortemi-react-1600x900.png"
---

# fortemi-react — June 2026

![The same memory service rendered as a glowing knowledge node-graph inside a browser window on a laptop — local-first, no server, private on the device.](https://docs.fortemi.com/react/assets/images/posts/2026-06/fortemi-react-1600x900.png)

*Hero image: AI-generated with ChatGPT from a brand-specified prompt; no text or logos are AI-rendered.*

*fortemi-react is the Fortemi memory service, built to run inside your web browser. Fortemi keeps notes for an AI agent and lets the agent search them by meaning. fortemi-react does that same job with no separate server — it all runs in the browser, on your computer. (It is the server in the browser. HotM, a different project, is a client that talks to the server.)*

## TL;DR

June was a busy, building month. The big theme: you can now load your notes **three ways** — from an in-browser database, straight from plain files with no database, or from a ready-made snapshot that starts fast. One shared design picks the best way for what you asked. Graph drawing moved into its own new package, `@fortemi/graph`, so any web app can use it. Search now runs off to the side, so the screen never freezes. And the docs went live at docs.fortemi.com/react. Updates shipped to npm steadily through the month.

## By the numbers

| What's public | Value |
|---|---|
| npm packages | `@fortemi/core`, `@fortemi/graph`, `@fortemi/react` |
| New this month | `@fortemi/graph` |
| Ways to load notes | in-browser database · plain files · snapshot |
| Docs | live at docs.fortemi.com/react |

## Highlights

**1. Three ways to load your notes — and one smart picker.**
What it is: a single, shared way to read your notes no matter where they live — an in-browser database, plain files, or (later) a remote server. A "picker" chooses the best source for what you asked.
How you'd use it: you don't pick by hand. Ask for what you want, and fortemi-react serves it from the fastest source that can do the job.
Why it helps: small sets can run with no database at all, and big sets can use the full database — same code, your choice, no rewrite.

**2. Read your notes straight from files — no database needed.**
What it is: a packaged set of notes (a "knowledge pack") can now be read in place as plain files, with no database to set up.
How you'd use it: drop the pack's files on any static web host and search them right there. This is the lightest, read-only way to use Fortemi.
Why it helps: no server, no setup, instant start. Perfect for read-only reference sets you just want to look things up in.

**3. Fast start with a ready-made snapshot.**
What it is: a snapshot is a copy of the database with its search index *already built in*.
How you'd use it: load the snapshot once, and you're ready — no waiting for the browser to build the search index.
Why it helps: building the search index in the browser is the slowest part of starting up. A snapshot skips it, so a big set of notes opens quickly.

**4. Search that never freezes the screen.**
What it is: the heavy parts of search now run off to the side, away from the screen.
How you'd use it: nothing to do — type your search as usual.
Why it helps: the page stays smooth while you type and scroll, even during meaning-based search on a large set.

**5. A new graph package any web app can use.**
What it is: the code that draws a map of how your notes connect now lives in its own new package, **`@fortemi/graph`**, with no extra parts needed.
How you'd use it: a plain JavaScript app — no React, no database — can now draw the same note map.
Why it helps: the graph is no longer locked to one setup. More apps can show your notes as a picture.

**6. Note maps that come out the same every time.**
What it is: the layout that arranges the note map now settles to the *same* picture for the same notes, every run.
How you'd use it: generate a map and save it as an image — it will look the same when you make it again.
Why it helps: stable, repeatable pictures work for saved images and for pages built ahead of time. No more random shifting.

## Features shipped

**One shared way to reach your notes.** This was the month's biggest piece of work. Before, the code that read your notes was tied to one storage type. Now there is a single shared contract — ask to list, get, or search notes the same way, no matter where they live. Three sources plug into it: the in-browser database, plain files, and (built as groundwork) a remote server. A "picker" then negotiates: it chooses the source that fully answers your request with the least startup cost, and if none can do everything, it picks the closest match — so you fall back on purpose, not by accident.

**Plain-files reading, in clusters.** A knowledge pack used to be something you imported into the database. Now the *same* pack is dual-mode: import it as before, **or** read it in place as static files with no database. The reader does full-text search with word-by-word matching, ranking, and snippets — the same results you'd get from the database. Big packs can be split into clusters (smaller pieces) so they load a part at a time instead of all at once. Paging through the same search re-reads nothing, because the matches are remembered.

**Faster starts: snapshots, prefetch, and warming.** Three features attack the "first load is slow" problem. **Snapshots** ship the database with its search index already built, so there's nothing to build on your machine — and the snapshot checks its own version before loading, so a mismatched file fails safely instead of breaking. **Prefetch** quietly downloads a pack's files in the background while you're idle, so when you click to open a bigger set, only the quick part is left. It can also check the download against a known fingerprint (a SHA-256 hash — a unique signature for a file), so you know the bytes weren't tampered with.

**Search moved fully off the main screen.** Meaning-based search turns your words into numbers the computer can compare (an "embedding" — a meaning fingerprint). That step used to run on the main screen and could make typing stutter. Now it runs on a side worker, so meaning search is off-screen from end to end and the page stays responsive.

**The `@fortemi/graph` package.** The graph tools — arranging, filtering, coloring, sizing by how connected a note is, finding a note's neighbors, and saving views — were pulled out into a small, stand-alone package with no dependencies. The code that drives the graph also became framework-free, with a thin React wrapper on top. Plain JavaScript apps can now draw Fortemi note maps without React or a database. The community-graph layout also became repeatable: the same notes settle to the same picture every time, so saved images and pre-built pages stay stable.

**Concept tags and where-it-came-from history, everywhere.** Notes can carry concept tags (a standard way to tag notes with ideas and link related ideas) and a where-it-came-from record (a trail of where a note originated). This month those became first-class on *every* source, including the plain-files reader, and there's now a proper write tool for tagging notes and recording origins — no more hand-written database commands.

**Browser-side project index.** fortemi-react can read and search project-index files right in the browser — including documentation and page records — with ranking and snippets, a lightweight stand-alone export, and safe link IDs for static hosts. This is the surface that powers the tool-picker in AIWG's Cockpit dashboard.

## Fixes

Most fixes hardened the new piece-by-piece (chunked) mode. Note counts now read correctly when the index is loaded in parts, the "export review decisions" tool works without loading the whole index, and detail links no longer break for note IDs that contain a slash on static hosts. A speed fix stops a paged search from re-scanning every part on each page. The job queue now skips a job whose needed feature is turned off, instead of running it and failing. The docs site got fixes too: it now mounts correctly so published pages render, and the welcome quick-links use the right link format. The getting-started guide stopped pointing at pages that didn't exist.

## Performance & reliability

Speed was the quiet story of the month. Snapshots, prefetch, off-screen search, and piece-by-piece loading all aim at one thing: opening a large set of notes without a long wait or a frozen screen. A dedicated speed fix remembers a search's matches so paging the same query re-scans nothing. On reliability, the snapshot path checks its own version before loading and fails safely on a mismatch instead of breaking.

## Breaking changes & migrations

None this month. The new ways to load notes are additive — the older database-import path still works exactly as before, and an old single-file pack stays valid. The snapshot option is backward compatible: code that doesn't use it is unaffected.

## Releases

Updates shipped roughly every day or two — small and steady, so fixes reach you quickly. Each one is public on npm.

- **2026.6.0** (Jun 12) — first June release; steadier job handling.
- **2026.6.1** (Jun 14) — off-screen database mode and scalable pack loading; safer providers and graph views.
- **2026.6.2** (Jun 15) — introduces the new **`@fortemi/graph`** package; piece-by-piece index loading.
- **2026.6.3** (Jun 15) — all packages moved to one shared version.
- **2026.6.4** (Jun 16) — lighter scan parts that fetch heavy detail only when needed; README repositioned around local-first / private-by-default.
- **2026.6.5** (Jun 16) — the plain-files source, the snapshot restore, the shared backend design, and the search-paging speed-up.
- **2026.6.6** (Jun 17) — concept-tag and origin history completed across all sources.
- **2026.6.7** (Jun 18) — docs synced to the current code.
- **2026.6.8** (Jun 21) — richer project-index details.
- **2026.6.9** (Jun 24) — repeatable note-map layout; docs-site fixes.

## Dependencies & security

No security alerts needed fixing this month. The published packages now move to one shared version, so they never drift apart. The docs site is built with the latest Pagenary publisher. On the safety side, prefetch can verify a downloaded pack against a known fingerprint (a SHA-256 hash), so you can confirm the bytes are the ones you expected.

## Docs & developer experience

The fortemi-react docs went live at **docs.fortemi.com/react**, published with Pagenary. The README and docs were repositioned around a clear promise: **local-first and private-by-default** — your notes stay on your computer, and nothing goes to a server unless you choose. There's a written design note explaining the new shared backend, the getting-started links were fixed, and the docs were synced to match the code.

## Tests & CI

The new shared backend and its picker shipped with tests covering the picker, the no-database file reader, and the database path (list, get, search, full-note read, and writes). The release pipeline now keeps all packages on one shared version and had its checks tidied so releases run cleanly.

## Cross-project impact

- **magly.net** uses the published `@fortemi/` packages, so this month's work flows straight into that site.
- **AIWG Cockpit** (the dashboard for watching agents) gets its tool-picker from fortemi-react's browser-side project index.
- **Pagenary** (the publishing tool) builds the new docs site — the Fortemi family using its own parts.
- fortemi-react is the **browser build of the Fortemi server**, so this work keeps the in-browser version in step with the Fortemi server core.

## Known issues & open threads

- The **remote-server source is future work.** The shared design leaves room for a third option — talking to a remote Fortemi server over the network — and the groundwork is in place, but the live remote connection was left for a later round.
- Snapshots and clustered packs are new. As more people load very large sets, expect more tuning of how packs are split and warmed.

## What's next

Wire up the remote-server source so the in-browser server can also read from a remote Fortemi server. Keep tuning startup on large sets (snapshots, prefetch, clustering). Continue the graph work in `@fortemi/graph`. And keep the browser build moving in step with the Fortemi server core. Small, steady releases will keep coming.

## Appendix

- **Published packages:** `@fortemi/core`, `@fortemi/graph` (new this month), `@fortemi/react` — on npm.
- **Releases:** the 2026.6.x series, published to npm through June.
- **Source / docs:** github.com/Fortemi/fortemi-react · docs.fortemi.com/react · window: all of June 2026.
