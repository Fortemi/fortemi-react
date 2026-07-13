---
title: Search
tags: data, search
---

# Search

`useSearch` runs PostgreSQL full-text search in the browser with `ts_headline`
snippets and tag facets — no model download for the lexical path.

```ts
const { search } = useSearch()
await search('layout', { mode: 'text' })
```

Enable the embedding [capability](09-capabilities) to add semantic ranking on
top of the lexical index.
