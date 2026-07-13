---
title: The Graph Stack
tags: graph, react
---

# The Graph Stack

`@fortemi/graph` turns any `CommunityGraph` into a laid-out `RenderGraph` with
`bakeRenderGraph`. It is framework-agnostic and has **no database dependency**
at its root — JS-only hosts use it directly.

The React tier adds three views: `GraphView` (SVG), `SigmaGraphView` (2D
WebGL), and `ForceGraph3DView` (3D). All share one filter contract — see
[graph controls](07-graph-controls).
