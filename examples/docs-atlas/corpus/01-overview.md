---
title: Fortémi Overview
tags: intro, architecture
---

# Fortémi Overview

Fortémi is a knowledge-management engine that runs **entirely in the browser**.
The data layer is PostgreSQL compiled to WebAssembly (PGlite); the graph layer
is framework-agnostic; the React layer is a thin set of hooks and views.

## The package chain

The dependency direction is linear: `@fortemi/core` holds the data layer,
`@fortemi/graph` adds projection and layout on top of it, and `@fortemi/react`
binds both to hooks and views. Each layer is usable on its own.

Read the [installation guide](02-install) next, then wire up the
[provider](03-provider).
