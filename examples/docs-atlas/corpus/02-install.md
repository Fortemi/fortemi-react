---
title: Installation
tags: intro, setup
---

# Installation

```bash
npm install @fortemi/core @fortemi/react
```

Add `@fortemi/graph` when you want graph views, and nothing else — no server,
no build-time database, no model downloads by default.

## Peer versions

React 19 is required. The packages ship ESM with subpath exports
(`@fortemi/react/graph`, `@fortemi/core/aiwg-index`), so bundlers tree-shake the
parts you do not use.
