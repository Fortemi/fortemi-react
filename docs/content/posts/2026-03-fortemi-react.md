---
template: post
title: "Fortémi React — March 2026"
date: 2026-03-01
author: Fortémi Team
summary: "The month fortemi-react began. The project went from an empty repository to a working memory system that runs entirely in your web browser — notes, search by keyword and by meaning, on-device AI features, attachments, and a shareable knowledge pack format."
tags: [report, fortemi-react, "2026-03", agent-memory]
---

# fortemi-react — March 2026

*fortemi-react is the Fortemi memory service, built to run inside your web browser. Fortemi keeps notes for an AI agent and lets the agent search them by meaning. fortemi-react does that same job with no separate server — it all runs in the browser, on your computer. (It is the server in the browser. HotM, a different project, is a client that talks to the server.)*

## TL;DR

This is where fortemi-react started. The project began on **March 20, 2026**, and in its first days it went from an empty repository to a working memory system that runs entirely in the browser. By the end of the month you could keep notes, search them by keyword and by meaning, let on-device AI write titles and tags, attach files, and pack a whole set of notes into a single shareable file. Nothing was published to the public npm registry yet — the first public packages came in May — but the whole foundation was built this month. This is an inception report: a look at what got laid down.

## By the numbers

| What's public | Value |
|---|---|
| Project started | March 20, 2026 |
| npm packages | none yet — first public release shipped in May |
| Where it runs | entirely in your web browser, no server |
| Source | github.com/Fortemi/fortemi-react |

## Highlights

**1. A memory system that runs in the browser — no server.**
What it is: fortemi-react keeps an AI agent's notes and lets it search them, and it does the whole job inside a normal web browser. There is no separate server to run.
How you'd use it: open a page, and your notes live right there on your computer.
Why it helps: your notes stay on your machine, private by default, with nothing to install or host.

**2. A real database, inside the page.**
What it is: notes are stored in a full database (Postgres) that was made to run inside the browser (this build is called PGlite).
How you'd use it: you don't manage it — it just works when the page loads.
Why it helps: you get the power of a real database — reliable storage, proper search — without any setup or a server.

**3. Search by keyword and by meaning.**
What it is: you can find notes two ways — by the exact words in them, and by what they *mean*. Meaning-based search turns your words into numbers the computer can compare. This is called an "embedding" — a meaning fingerprint. So a search for "car" can also find a note about "automobile."
How you'd use it: type a search; results come back ranked, with short snippets.
Why it helps: you find the right note even when you don't remember the exact words.

**4. On-device AI helpers.**
What it is: fortemi-react can write a title for a note, suggest tags, and keep a history of edits — using AI models that run on your own device.
How you'd use it: add a note, and the helpers fill in the details in the background.
Why it helps: less busywork, and the AI runs locally, so your notes don't have to leave your computer.

**5. A shareable "knowledge pack" format.**
What it is: a whole set of notes can be packed into a single file and later unpacked somewhere else. This is the Knowledge Shard format.
How you'd use it: export your notes as one file, hand it to someone, and they import it.
Why it helps: notes become portable — easy to back up, move, or share.

## Features shipped

**The foundation.** The project started from nothing on March 20. Within the month, it grew into a working browser memory system. Several pieces came together. There is the code package other apps will use, `@fortemi/core`, inside a shared workspace. There is the in-browser database and the tools that read and write notes. There is a small demo app to try it all. And there is a set of tools an AI agent can call to capture and look up knowledge.

**Search, done properly.** Full-text (word-by-word) search landed alongside meaning-based search, plus a mixed mode that uses both. Results are ranked, and each comes with a short snippet so you can see why it matched.

**The on-device AI pipeline.** fortemi-react learned to turn note text into meaning fingerprints, called embeddings, using a model that runs in the browser. It also learned to run a small language model on your device for writing titles and tagging notes. A background job queue handles this work, so the screen stays usable while it runs. Heavy AI models are opt-in. The app checks what your device can do, including its graphics chip, and only loads a model when you ask. So nothing large downloads by surprise.

**Attachments and file storage.** Notes can carry attached files, stored in a dedicated in-browser store, with a tool for managing them.

**The knowledge-pack format.** Import and export of the Knowledge Shard format arrived, so a whole set of notes can travel as one file — matching the format the Fortemi server uses, so packs stay compatible across the two.

**A clear name.** Early in the month the project was renamed from *fortemi-browser* to **fortemi-react**, settling on the name it carries today.

## Fixes

As the first code came together, early rough edges were smoothed. A flash in the search screen was fixed. Tests were aligned with the server-compatible job queue. And test runs were tuned so the in-browser database wouldn't overload the machine running them.

## Performance & reliability

From day one, the AI work was pushed onto a background job queue so it never froze the screen. Loading of heavy models was made opt-in and gated on what the device can handle — a reliability choice as much as a speed one, since it avoids large surprise downloads.

## Breaking changes & migrations

None this month. This was the first month of the project — there was nothing earlier to break.

## Releases

None this month. Nothing was published to the public npm registry in March. The work happened in the open on GitHub, and the first public packages shipped in May.

## Dependencies & security

No security alerts came up this month. Heavy AI models are opt-in and only load when you ask — a deliberate choice that keeps the default experience small and avoids pulling in large downloads you didn't request.

## Docs & developer experience

Documentation started early. This month brought the project's first design and planning documents and a set of developer guides covering how the pieces fit together and how to use search. The goal from the start was that a developer could read the guides and get going without digging through the code.

## Tests & CI

Testing began with the code. The job-queue tests were aligned with the server's behavior, and test runs were tuned so the in-browser database stays within the machine's limits. The automatic checks that run on every change (CI) were set up and hardened toward the end of the month.

## Cross-project impact

- fortemi-react is the **browser build of the Fortemi server** — so from its very first month, its knowledge-pack format was kept compatible with the Fortemi server, so notes can move between the two.
- The design leans on the wider Fortemi family: the same note model, the same pack format, one shared idea running in a new place (the browser).

## Known issues & open threads

- This was an inception month. The foundation was built fast, and the months that follow are about hardening it, publishing it, and filling in the pieces.
- Publishing to npm was still ahead. The code was public on GitHub, but packaged public releases were set up later.

## What's next

Turn the foundation into something people can install: package the code, publish it to npm, and put a proper release process behind it. Keep the browser build in step with the Fortemi server. Those steps start in the following months.

## Appendix

- **Published packages:** none yet in March — the first public releases came in May.
- **Project start:** March 20, 2026.
- **Source / docs:** github.com/Fortemi/fortemi-react · window: March 20–31, 2026.
