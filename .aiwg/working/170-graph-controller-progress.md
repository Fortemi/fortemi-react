# Progress: #170 GraphController extraction (+ #171 docs)

## Task contract
- Move graph-source state machine from `packages/react/src/hooks/useGraphController.ts` into a framework-agnostic `GraphController` in `@fortemi/graph`.
- `@fortemi/graph` MAY depend on `@fortemi/core` (maintainer-authorized). No port interface required.
- React hook becomes a thin `useSyncExternalStore` adapter. Public API/return shape unchanged.
- Folds #171: fix graph package description (drop "no DB / zero deps", state core dep + react/JS-host consumers).
- Completion: `pnpm typecheck && pnpm test:core` green + graph tests; PR with `Closes #170` / `Closes #171`.
- Delivery: pr-required, branch `feat/170-graph-controller`, default_branch main.

## Design (decided)
- `GraphController` in `packages/graph/src/controller.ts`.
- Ctor takes injected `GraphRepository` + `CommunitiesRepository`; static `fromDb(db)` builds them. Injected path = test seam.
- db type for fromDb: `QueryExecutor & DatabaseClient` (both exported from core index).
- Observable: `getState()` + `subscribe(fn)`; setters mutate state + fire-and-forget `refresh()` (mirrors hook's effect). `start()` = initial refresh.
- Types GraphSourceMode/GraphLayoutState/GraphTransitionState/GraphControllerStatus/GraphSourceControllerState/GraphControllerOptions move to graph (NOT currently in react public API — safe).
- CommunityGraph: core and graph each define structurally-identical version. Controller uses core's (it consumes repos). Structural compat holds.

## Steps
- [x] Branch, type topology resolved
- [x] Write packages/graph/src/controller.ts (port verbatim)
- [x] graph package.json: add @fortemi/core dep + description; tsup external:['@fortemi/core']
- [x] graph index.ts: export GraphController + types; header comment fixed
- [x] Rewrite useGraphController as useSyncExternalStore adapter; GraphView import repointed to @fortemi/graph
- [x] #171 docs: graph package.json desc, README (L7/30/34/44/56), CLAUDE.md (L30/35). AIWG.md predates graph (no false claim — skip)
- [x] controller unit test (no React, injected fakes)
- [x] VERIFY: typecheck green (4 pkgs); graph 39/39; react 4/4; graph build ESM+DTS; core shard 86/86 isolated (full-suite flake is pre-existing PGlite parallelism, core/src byte-identical to main; CI caps at VITEST_MAX_WORKERS=2)
- [x] commit (8ed9b89), push origin, PR #174 (Closes #170/#171); cycle comments on both issues

## DONE (autonomous portion)
PR #174 open → main. CI run #119 in_progress (capped at 2 workers). Remaining = human review + merge (pr-required) → auto-closes #170 + #171. No stale-close risk (closing keywords in PR body).

## Verification commands
- `pnpm --filter @fortemi/graph build && pnpm --filter @fortemi/graph test`
- `pnpm typecheck && pnpm test:core`

## Notes / failed approaches
- (none yet)
