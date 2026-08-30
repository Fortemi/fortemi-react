---
template: post
title: "Fortémi React — August 2026"
slug: "2026-08-fortemi-react"
author: Fortémi Team
date: "2026-08-28"
project: "fortemi-react"
type: report
tags: [report, "2026-08", "fortemi-react"]
summary: "August was a focused Core release for fortemi-react: safer repeat imports, scoped search fields, final-delete receipts, and clearer Knowledge Shard limits."
hero: "https://docs.fortemi.com/react/assets/images/posts/2026-08/fortemi-react-august-2026-hero.png"
heroAlt: "Sunlit glacier-blue glass forms rising from water, representing portable browser memory with clear provenance."
status: published
---

# fortemi-react — August 2026

fortemi-react is the browser edition of Fortemi. It gives React apps a local data layer for notes, search, portable archives, and graph views. It does not require a separate server.

## TL;DR

August was a focused release month for fortemi-react. `v2026.8.0` made Core better at three jobs. It can track where imported records came from. It can search inside approved fields. It can prove a final delete without keeping the deleted content. It also made portable archive claims more careful. If an archive profile cannot carry source identity links, the export says so. The public package set stayed the same: `@fortemi/core`, `@fortemi/graph`, and `@fortemi/react`.

## By the numbers

| What's public | Value |
|---|---|
| Released version | `v2026.8.0` |
| Published packages | `@fortemi/core@2026.8.0`, `@fortemi/graph@2026.8.0`, `@fortemi/react@2026.8.0` |
| Main package changed | `@fortemi/core` |
| Docs | docs.fortemi.com/react |

## Highlights

1. Repeat imports are safer. An app can now import records by their source, such as the tenant, archive, namespace, and external ID. If the same source data comes in again, Core can treat it as unchanged. It does not need to create copies.

2. Search can stay inside a tighter lane. Apps can filter on approved fields before ranking results. That helps when you only want results from one provider, model, role, event kind, sensitivity level, or import run.

3. Final deletes leave a receipt, not the content. Core added purge APIs that can preview the delete, remove related graph and search state, and return a receipt with no content. That helps when an app needs proof that cleanup happened without keeping the removed data.

4. Portable archives are clearer about limits. A Knowledge Shard is a portable Fortemi archive. This release reports when source identity links do not fit the selected `core-v1` or `record-v1` profile. It does not imply that every detail moved.

## Features shipped

### Source-Aware Import

Core can now import records by source identity. In plain terms, your app can say, "this note came from this source record." Core can remember that link.

That matters when imports run more than once. Say you import the same project notes every night. If nothing changed, the import can settle as unchanged. If the source content did change, the caller has to choose what to do. It can version it, replace it, or treat it as a conflict.

This helps keep local archives clean. It also gives import tools a clear way to avoid duplicate notes, duplicate revisions, and duplicate work.

### Scoped Metadata Search

Search now supports bounded field filters. The important word is bounded: the paths are approved ahead of time.

You would use this when a UI needs a narrower answer. For example, a review screen might search only records from one import run. Or it might search only records with a certain sensitivity label. Core applies those filters before text, semantic, hybrid, or recent ranking.

The result can still point back to evidence. It uses safer locators instead of raw external source keys.

### Final Purge Receipts

Core added terminal purge APIs for graph and content cleanup. The flow can preview what will be removed. Then it can complete the delete and return a receipt.

That receipt is content-free. It can prove the cleanup step happened without keeping deleted text or raw source identity. This is useful for apps that need a hard delete path with a small audit trail.

### More Honest Portable Archives

Some archive profiles are smaller than the full Fortemi shape on purpose. That is fine as long as the file says what it kept and what it could not keep.

In `v2026.8.0`, `core-v1` and `record-v1` exports report omitted source identity links as typed loss. So an app can still move the supported data. The user can also see that source identity was outside that profile.

## Fixes

None this month.

## Performance & reliability

This release improves reliability around repeat imports, scoped searches, and final deletion. The main benefit is cleaner behavior in edge cases. The same source data may appear more than once. A search may ask for a field path. A delete may need to return the same receipt. These paths now have clearer rules.

## Breaking changes & migrations

None this month.

The new PGlite migration is additive. Existing note, shard, and RecordStore data remain readable. Source identity and import-run records are created only when callers use the new APIs.

## Releases

- `v2026.8.0` (August 23, 2026) - Core source identity, typed search fields, terminal purge receipts, and clearer Knowledge Shard profile limits. Published packages: `@fortemi/core@2026.8.0`, `@fortemi/graph@2026.8.0`, and `@fortemi/react@2026.8.0`.

## Dependencies & security

No advisory-driven dependency change is called out in the public release notes.

The security-relevant change is in behavior. Search field paths are allowlisted, and unsupported paths fail clearly. Search results can also use source hashes and field paths instead of raw external source keys.

## Docs & DX

The React docs remain available at docs.fortemi.com/react. They link to getting started, integration, API reference, package pages, examples, and release posts.

For React apps, the public install path is still:

```bash
pnpm add @fortemi/react @fortemi/core react
```

The basic import stays centered on `FortemiProvider` and hooks from `@fortemi/react`.

## Tests & CI

The release notes call out focused tests for source-addressed import, field locators, purge receipts, Core behavior, portable contracts, typecheck, and Knowledge Shard contract checks.

The repository CI also received a cache-isolation fix for pnpm setup. That is release plumbing, not a user-facing feature. It helps keep future package builds cleaner.

## Cross-project impact

None this month.

## Known issues & open threads

Knowledge Shard claims remain profile-scoped. Check the profile name before treating an archive as complete. `core-v1`, `record-v1`, and `full-v1` do not promise the same shape.

## What's next

None this month.

## Appendix

- Published packages: `@fortemi/core`, `@fortemi/graph`, `@fortemi/react`.
- Released version: `v2026.8.0`, published August 23, 2026.
- Source / docs: github.com/Fortemi/fortemi-react · docs.fortemi.com/react.
- Window: August 2026.
