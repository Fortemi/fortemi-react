---
title: FortemiProvider
tags: setup, react, data
---

# FortemiProvider

`FortemiProvider` boots the in-browser database and exposes it through context.

```tsx
<FortemiProvider persistence="memory">
  <App />
</FortemiProvider>
```

`persistence="memory"` gives a disposable database for demos; switch to `opfs`
or `indexeddb` for durable storage. Two providers with different `archiveName`
values hold independent databases — the basis for the
[shard exchange](08-shards) demos.
