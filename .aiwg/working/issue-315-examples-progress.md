# Progress: Issue #315 — examples program

## Task contract
- Original request: address-issues 315 (epic: examples program across all @fortemi packages)
- Tracker: Gitea Fortemi/fortemi-react; delivery mode: pr-required
- Completion criteria (this tranche): infrastructure + no-DB graph tier (EX-01…EX-05) + EX-09
  build & typecheck green; PR opened referencing #315; cycle comment posted to epic thread.
- Epic stays OPEN (19 examples total; delivering first coherent tranche).

## Current status
- Phase: building infra + EX-01, then prove toolchain
- Next action: create examples/_shared generator + EX-01, run pnpm install + tsc + vite build

## API notes (verified from source)
- @fortemi/graph: CommunityGraph {nodes[{id}], edges[{source,target,weight,kind?}], communities[{id,nodes[]}]}
- renderCommunityGraph(container, graph, {labelFor,width,height,background,algorithm,filters,onSelectNode,onNavigate}) -> handle {update,destroy?}
- mapCommunityGraph(graph,{labelFor,palette,positions,radius,sizeFor}) -> RenderGraph
- layoutCommunityGraph(graph, LayoutOptions{algorithm,width,height,seed,ticks,...}) -> PositionedGraph
- bakeRenderGraph(graph,{layout,...}) -> RenderGraph (baked x/y); stringifyRenderGraph; loadRenderSnapshot(url|obj|thunk)->RenderGraph|null
- applyControlFilters(graph, {communityIds,edgeKinds,nodeIds,minDegree}); communityLegend(graph)
- @fortemi/react/graph: GraphView props {graph:CommunityGraph, layout?:{algorithm}, filters, selectedNodeId, onSelectNode, onNavigate, labelFor, draggableNodes, width, height}
- @fortemi/react/graph-2d: SigmaGraphView props {graph:CommunityGraph|RenderGraph, snapshot?, filters, labelFor, palette, onSelectNode, onOpenNode, settleMs, theme, height}
- @fortemi/react/graph-3d: ForceGraph3DView props {graph, snapshot?, filters, labelFor, palette, onSelectNode, onOpenNode, theme, height}
- Toolchain in store: react 19.2.4, react-dom 19.2.4, @types/react 19.2.14, ts 5.9.3, vite 7.3.1, @vitejs/plugin-react 4.7.0, @types/node 22.19.15, sigma 3.0.3, graphology 0.26.0, graphology-layout-forceatlas2 0.10.1, three 0.185.1, react-force-graph-3d 1.29.1
- Packages already built (dist present).

## Key decision (verified)
- No-DB graph examples pull PGlite WASM via @fortemi/graph -> GraphController -> @fortemi/core.
  Tree-shaking drops the JS but Vite still emits 8.7MB orphan WASM assets.
  FIX: per-example inline Vite plugin `stubFortemiCore` aliases @fortemi/core to
  {GraphRepository,CommunitiesRepository} empty classes. Result: EX-01 = 6 modules, 14KB, no PGlite.
  Apply stub to EX-01,02,03,04,05,09. Do NOT stub DB examples (EX-06,07,08,16,17).
- Follow-up recommendation (NOT done here, would expand scope): split GraphController to
  @fortemi/graph/controller subpath so the root barrel is core-free.

## Plan (this tranche)
1. [x] Research graph + react public APIs (exports, types, layout/bake/render fns)
2. [~] Infra: workspace glob DONE; _shared DONE; CI job + docs index TODO
3. [x] EX-01 graph-svg-vanilla (no React, no DB) — builds clean (14KB, no PGlite)
4. [ ] EX-02 graph-view-static (React, no DB)
5. [ ] EX-03 graph-2d-live (Sigma)
6. [ ] EX-04 graph-3d-orbit (ForceGraph3D)
7. [ ] EX-05 snapshot-baking (bake node script + warm load)
8. [ ] EX-09 graph-controls-playground
9. [ ] Verify build + typecheck for examples
10. [ ] Branch, commit, open PR (Refs #315, do NOT close epic), post cycle comment

## Failed approaches (do not retry)
- (none yet)

## State references
- Epic: git.integrolabs.net/Fortemi/fortemi-react#315

## COMPLETE (tranche 1) — 2026-07-13
- Delivered: infra (examples/ workspace, _shared generator, tsconfig.base, examples CI job, examples/README, docs/content/examples + manifest entry)
  + EX-01, EX-02, EX-03, EX-04, EX-05, EX-09. All typecheck + build green. Zero PGlite in any dist.
- CI parity verified: pnpm install --frozen-lockfile OK; pnpm typecheck OK; pnpm lint OK.
- Next: branch feat/315-examples-program, commit, push, PR (Refs #315, epic stays open), cycle comment.

## CI fix (commit 27264aa)
- First push: `examples` CI job PASSED (builds libs -> typechecks+builds all examples). e2e/lint/portable-contract green.
  Only global `typecheck` job FAILED — it runs before dist is built, and examples resolved @fortemi/* -> dist .d.ts (absent in CI).
- Fix: added source `paths` to examples/tsconfig.base.json (matches root tsconfig.base.json). tsc -> source; Vite -> dist (bundles unchanged).
- Verified: examples typecheck + full workspace typecheck + lint all green locally; EX-01/02 rebuild clean (no PGlite).
- Polling CI on 27264aa for typecheck to go green (background task brn3cbz72).

## Tranche 2 — core-data tier (EX-06/07/08) — 2026-07-13
- Delivered EX-06 notes-crud-minimal, EX-07 search-basic, EX-08 shard-reader.
- DB examples DO ship PGlite (intentional; the DB is the point). persistence="memory".
- New shared helper examples/_shared/vite-db.ts (@fortemi/examples-shared/vite-db):
  worker.format:'es' + optimizeDeps.exclude pglite + COOP/COEP headers + wasm dev plugin.
  Fixes the "worker.format iife not supported for code-splitting" build error the
  @fortemi/react module Worker triggers. Every DB example spreads fortemiDbConfig.
- EX-08 = export→reopen round-trip: exportShard(db) -> useShard(bytes) (reader is PGlite-free
  by design, #189) + drop-an-external-.shard. Uses @fortemi/core exportShard + @fortemi/react useShard.
- Verified: frozen-lockfile install OK (lockfile in sync); full workspace typecheck OK;
  lint OK; all 3 DB examples build (260-261 modules, PGlite present as expected).
- Indexes updated: docs/content/examples/index.md + examples/README.md (core-data delivered table,
  vite-db infra note, EX-06/07/08 removed from Planned).
- Epic scope reminder (Stop hook): epic #315 must be addressed toward CLOSURE. Tiers remaining:
  intermediate EX-10..15, composed apps EX-16..19. Continue until deliverable set is comprehensive,
  then convert PR to Closes #315.

## Failed approaches (do not retry)
- `pnpm install --config.minimumReleaseAge=0` -> interactive reinstall prompt. Use plain
  `pnpm install --no-frozen-lockfile --prefer-offline` (no CI=1).
- DB example without worker.format:'es' -> vite build fails on the react module Worker. Must use vite-db config.

## CI fix (core-data typecheck, run #356) + tranche 3 start — 2026-07-13
- CI #356: examples/lint/unit-test/e2e/portable-contract PASSED; global `typecheck` FAILED.
  Cause: DB examples import @fortemi/react ROOT barrel -> re-exports useAiwgIndex ->
  imports @fortemi/core/aiwg-index (a core SUBPATH). examples/tsconfig.base.json mapped
  bare @fortemi/core to source but NOT the subpaths, so fresh-CI (no dist) failed TS2307.
  Local passed only because packages/core/dist existed.
  FIX: add @fortemi/core/aiwg-index, /worker/pglite-worker, /service-worker/sw source
  paths to examples/tsconfig.base.json (mirrors root tsconfig.base.json).
  Reproduced by hiding ALL packages/*/dist -> all examples still typecheck via source paths. Verified.
- Tranche 3 (intermediate, started): EX-10 notes-graph-explorer (DB+graph: CommunityGraph
  from note tag co-occurrence -> GraphView -> useNote on click; no embeddings),
  EX-15 custom-canvas-renderer (no-DB: bakeRenderGraph -> hand-written <canvas>, stub plugin, 204KB).
- Verified: all 11 examples build; full workspace typecheck (dist-hidden repro) green; lint green.
- Indexes updated (Intermediate tables in docs + README; Planned trimmed).
- Remaining toward epic closure: EX-11 aiwg-index-map, EX-12 local-ai-setup, EX-13 shard-exchange,
  EX-14 remote-backend, EX-16..19 composed apps.

## Tranche 4 — composed apps (EX-16/19) + EX-13 — 2026-07-13
- Delivered EX-13 shard-exchange, EX-16 knowledge-garden, EX-19 dual-instance-sync.
  All CI green (workspace typecheck + lint + all example builds).
- EX-13/19: two FortemiProviders (distinct archiveName -> independent in-memory DBs);
  useImportShard().importShard(file, strategy) — wrap bytes in `new File([ab],'x.shard')`
  (hook exposes importShard(file), NOT runImport(bytes)). EX-19 converges to note-set UNION,
  idempotent bidirectional shard swap ('skip' conflict). EX-16 composes CRUD+search+tag-graph+detail
  over ONE db with a shared selection; search filters list + spotlights graph via filters.nodeIds.

## Tranche 5 — EX-11 aiwg-index-map — 2026-07-13
- Delivered EX-11 aiwg-index-map. useAiwgIndex(sampleIndex) -> toCommunityGraph() -> GraphView;
  communities default to `type:<kind>` (records carry no concepts) so the legend = artifact taxonomy;
  search(q,{rank:true}) -> data.items ids -> GraphView filters.nodeIds spotlight; counts = per-type chips;
  node click -> record detail (title/type/tags/relationships).
- Hand-authored AiwgFortemiIndexExport fixture (src/index-fixture.ts, rec() helper): 12 records
  (3 agents, 3 commands, 3 rules, 2 skills, 1 doc) with cross-type relationships (uses/enforces/
  governed-by/documents/invoked-by/related). Schema verified against packages/core/src/aiwg-index.ts.
- No FortemiProvider mounts -> PGlite worker/wasm ship in dist (hook re-exports from @fortemi/react
  root barrel which carries FortemiProvider) but are NEVER fetched/compiled at runtime. Zero runtime
  download, instant. Decision: did NOT add a PGlite-free @fortemi/react/aiwg-index subpath export —
  that reshapes the published library surface (out of demo scope; human-authorization). README states
  the tradeoff honestly.
- Uses shared DB vite config (fortemiDbConfig) because the root-barrel module Worker needs worker.format:'es'.
- Verified: workspace typecheck green, lint green, build green (262 modules).
- Indexes updated (Intermediate tables in docs + README; Planned trimmed to EX-12/14/17/18).
- Remaining toward epic closure: EX-12 local-ai-setup, EX-14 remote-backend, EX-17 docs-atlas,
  EX-18 research-workbench. 15/19 delivered.
