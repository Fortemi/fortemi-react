---
title: AIWG Index
tags: aiwg, graph, index
---

# AIWG Index

`useAiwgIndex` reads an AIWG artifact index — agents, commands, rules, docs —
and projects it to a `CommunityGraph` with `toCommunityGraph()`. Communities
default to the artifact **type**, so the graph legend becomes the taxonomy.

It reuses the [graph stack](06-graph) with no database: the index is a static
object, so nothing boots. This atlas itself is built the same way — a corpus,
baked at build time into the snapshot you are reading now.
