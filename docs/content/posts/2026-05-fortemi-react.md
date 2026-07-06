---
template: post
title: "Fortémi React — May 2026"
date: 2026-05-01
author: Fortémi Team
summary: "The month fortemi-react went public. The first packages shipped to npm with a signed, verified release process — and the same month brought note maps that group related notes, plus expanded docs for new readers."
tags: [report, fortemi-react, "2026-05", agent-memory]
---

# fortemi-react — May 2026

*fortemi-react is the Fortemi memory service, built to run inside your web browser. Fortemi keeps notes for an AI agent and lets the agent search them by meaning. fortemi-react does that same job with no separate server — it all runs in the browser, on your computer. (It is the server in the browser. HotM, a different project, is a client that talks to the server.)*

## TL;DR

May is when fortemi-react went public. The first packages — **`@fortemi/core`** and **`@fortemi/react`** — shipped to the npm registry on May 23, so anyone could install them. They ship with a signed, verified release process, so you can trust that a release is really from the project. The same month added note maps that group related notes together on their own. It also filled out the package docs, so a new reader can understand what fortemi-react is without reading the code first.

## By the numbers

| What's public | Value |
|---|---|
| npm packages | `@fortemi/core`, `@fortemi/react` |
| First public release | 2026.5.0 — May 23 |
| Releases this month | five (2026.5.0 → 2026.5.4) |
| Source / docs | github.com/Fortemi/fortemi-react |

## Highlights

**1. The first public release — install it from npm.**
What it is: the two core packages went live on the public npm registry, so you can add them to a project the normal way.
How you'd use it: install `@fortemi/core` (and `@fortemi/react` for a React app) and start keeping and searching notes in the browser.
Why it helps: fortemi-react stopped being something you had to build from source. It's now a package you can just install.

**2. Releases you can trust.**
What it is: every release is signed and checked before it goes out. The published packages also carry npm "provenance" — a public record of where and how they were built.
How you'd use it: nothing extra to do — the trust checks run for you.
Why it helps: you can be confident a release really came from the project and wasn't tampered with on the way.

**3. Note maps that group related notes.**
What it is: fortemi-react can build a map of your notes and automatically find clusters — groups of notes that are closely related (these are called communities).
How you'd use it: ask for a similarity map, and see your notes fall into natural groups, with the result cached so it doesn't rebuild every time.
Why it helps: patterns you didn't notice become visible — related ideas cluster together at a glance.

**4. Docs that explain the value up front.**
What it is: the package pages were expanded to explain what fortemi-react is, how it's built, what it's for, and how storage and privacy work — written for someone meeting it for the first time.
How you'd use it: read the package page on npm or the docs and get the whole picture without digging through code.
Why it helps: new readers can decide if it fits their needs quickly.

## Features shipped

**The first coordinated release.** The headline was going public. A publish process was built and then used: `@fortemi/core` and `@fortemi/react` were published to npm together, starting with **2026.5.0** on May 23. Releases are tied to signed tags and verified before they ship, and the build pipeline that produces the packages was put in place just before.

**Graph, community, and embedding-set features.** Late in the month, fortemi-react gained tools for working with your notes as a connected map. It can build a similarity map, which shows which notes are alike. It can find communities, which are clusters of closely related notes. And it remembers those results, with freshness tracking, so it doesn't rebuild them for nothing. It also gained flexible "embedding sets" — named groups of meaning fingerprints you can define by rules, combine, or snapshot. The knowledge-pack format learned to carry these graph and community pieces too, so they travel with your notes. React apps got matching hooks for all of it.

**Expanded package documentation.** The `@fortemi/core` and `@fortemi/react` package pages were filled out for new readers. They now cover the project's value, its architecture, and its use cases. They explain the search and knowledge model, the tool surface, and how storage and privacy work. So a new npm reader can understand each package on its own.

**Host-neutral naming.** The tools fortemi-react exposes were standardized under one clear namespace (`fortemi.*`). Old references to a specific downstream app were removed from docs, code comments, and tests. So the language now matches the general-purpose service it is.

**A pluggable storage backend and safer plugins.** Storage was made pluggable, so where notes are kept can be swapped without touching the rest of the app. Separately, the way the app loads plugin scripts was hardened, closing a path that could otherwise load untrusted code.

## Fixes

The release process itself took most of the fix attention as it was proven out end to end. Release credentials were split, so each destination uses its own key. Manual re-runs of a publish were fixed to pass the chosen tag through the signing check. And repository release pages were fixed to show a proper title and the prepared announcement, instead of generic text. A test fix also stopped future database changes from forcing test rewrites, so schema work won't create busywork later.

## Performance & reliability

The new similarity maps and community groups are cached with freshness tracking, so asking again doesn't rebuild the whole thing — a speed win for repeated views. On reliability, signed-and-verified releases mean a broken or unofficial build fails the checks instead of reaching users.

## Breaking changes & migrations

No breaking changes for everyday use. Upgrading through the month adds new database steps for the embedding-set and graph features. Existing note stores update themselves when opened. Existing React hooks keep working, and the new graph and community hooks are additive. One naming note: apps that read the tool IDs should use the `fortemi.*` names, and code using the bridge helper should use its current names.

## Releases

Five releases shipped this month — the first public ones. Each is public on npm.

- **2026.5.0** (May 23) — the first public release: `@fortemi/core` and `@fortemi/react` published to npm, with signed release-tag checks.
- **2026.5.1** (May 24) — proved the full publish path end to end and republished cleanly.
- **2026.5.2** (May 24) — release-process polish: separate keys per destination, and release pages that carry the prepared announcement.
- **2026.5.3** (May 24) — much fuller package docs for npm readers, plus host-neutral naming cleanup.
- **2026.5.4** (May 27) — note maps: similarity graphs, community grouping, flexible embedding sets, matching React hooks, and supply-chain hardening (npm provenance and a mirror publish).

## Dependencies & security

Security got real attention this month. The plugin script loader was hardened so it won't run untrusted code, and published packages now carry npm provenance — a public, checkable record of how they were built. Release signing means each package is verified before it ships. No outstanding security alerts remained at month's end.

## Docs & developer experience

The `@fortemi/core` and `@fortemi/react` package pages were expanded into proper intros. The getting-started and integration docs were rewritten in host-neutral language, so they read for any app, not one specific downstream. The result: someone new can read a package page and understand the whole offering.

## Tests & CI

A coverage gate was added for the core package, so a drop in test coverage is caught automatically. The graph, community, and embedding-set features shipped with their own tests, and a migration-count test was fixed so future database changes don't force test rewrites.

## Cross-project impact

- With the first npm packages live, other projects can now depend on published `@fortemi/` versions instead of building from source.
- fortemi-react remains the **browser build of the Fortemi server**, and going public this month kept the in-browser version moving in step with the server core.
- The note-map and community features set up the graph work that grows further in the following months.

## Known issues & open threads

- The note-map and community features were new this month; they were expanded and refined afterward.
- Only `@fortemi/core` and `@fortemi/react` were published in May. A separate graph package came later.

## What's next

Build on the public base. Keep improving how notes load and search in the browser. Grow the note-map and community tools. And keep up the small, steady release pace now that the pipeline is proven. The graph work in particular keeps expanding in the months ahead.

## Appendix

- **Published packages:** `@fortemi/core`, `@fortemi/react` — on npm.
- **Releases:** the 2026.5.x series (2026.5.0 → 2026.5.4), published to npm through May.
- **Source / docs:** github.com/Fortemi/fortemi-react · window: all of May 2026.
