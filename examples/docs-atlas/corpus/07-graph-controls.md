---
title: Graph Controls
tags: graph, react, ui
---

# Graph Controls

Every graph view reads the same filter contract:

```ts
{ minDegree, communityIds, nodeIds, edgeKinds }
```

One control panel drives `GraphView`, Sigma, and 3D without rewiring. Degree
filtering, neighborhood highlight, palette switching, and draggable pinning are
all expressed through this contract — the reusable core of the
[graph stack](06-graph).
