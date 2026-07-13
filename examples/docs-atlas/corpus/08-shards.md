---
title: Knowledge Shards
tags: data, shards, sync
---

# Knowledge Shards

A Knowledge Shard is a `tar.gz` of notes plus BLAKE3-hashed attachment blobs.
`exportShard(db)` bakes one; `useShard` browses it read-only **without PGlite**;
`useImportShard` merges it back with a conflict strategy.

Two instances exchanging shards both ways converge to the union of their notes —
shards as a poor-man's sync transport over the [data layer](04-notes).
