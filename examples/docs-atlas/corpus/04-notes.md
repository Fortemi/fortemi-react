---
title: Notes and CRUD
tags: data, react
---

# Notes and CRUD

Notes are the atomic unit. The lifecycle is four hooks:

- `useNotes` — paginated listing,
- `useCreateNote`, `useUpdateNote`, `useDeleteNote` — mutations.

Deletes are **soft** (`deleted_at`) — nothing is destroyed, so a shard export
round-trips history. Combine notes with [search](05-search) and the
[graph stack](06-graph) to build a workspace.
