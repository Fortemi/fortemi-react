# Progress: graph-example UX — 2D/3D toggle + node summary card

## Task contract
- Original request: "All graph views should have 2d/3d options" + "all node clicks should have similar data summary popups as magly.net or pagenary"
- Scope decisions (from user):
  - 2D/3D toggle → **every graph example** (all 9)
  - Node popup → **match the references** at `/srv/vmshare/dev-inbox/jmagly/{magly.net,pagenary}`
- Completion criteria:
  - Each of the 9 graph examples has a working `[2D | 3D]` toggle (2D = existing renderer, 3D = lazy ForceGraph3DView; Three.js only loads on 3D)
  - Each graph example shows a node-summary card on node click, matching pagenary's detail (title + concept/tag chips + community + degree + optional open)
  - typecheck + lint + affected tests green; spot-checked in browser
- Authorization: features authorized by user's scope answers. Separate PR from the bug-fix PR #329.

## References studied
- 2D/3D toggle: `magly.net/src/components/fortemi/GraphView.tsx` — `Mode='2d'|'3d'`, segmented buttons, `mode==='3d' ? <Suspense><Graph3D/></Suspense> : <2D>`. Graph3D lazy-imported.
- Node detail: `pagenary/apps/react/src/docs-map/index.jsx` — `<aside class="…__detail"><h2>{selectedLabel}</h2>` + concept chips (`selectedConcepts.slice(0,8)`) + "Open page" button; neighborhood-focus mode; status line echoing selection. Uses upstream `<GraphView onSelectNode>`.
- Helpers: `pagenary/.../docs-map/graph-data.js` — labelFor/humanize/conceptsFor.

## The 9 graph examples (renderer today)
- SVG-only GraphView: aiwg-index-map, graph-view-static, knowledge-garden, notes-graph-explorer, research-workbench
- Sigma 2D: graph-2d-live
- 3D: graph-3d-orbit
- Multi-renderer already: custom-canvas-renderer, graph-controls-playground

## Plan
1. [x] Confirm `examples/_shared` (@fortemi/examples-shared) can host TSX React components (peer react, jsx config).
2. [x] Build shared `GraphModeToggle` (`[2D | 3D]` segmented) — presentational, controlled.
3. [x] Build shared lazy `Graph3DLazy` wrapper (Suspense around ForceGraph3DView from @fortemi/react/graph-3d).
4. [x] Build shared `NodeSummaryCard` matching pagenary detail (title, community swatch+name, degree, concept/tag chips, optional open action).
5. [x] Wire toggle + card into all 9 examples (2D keeps each example's existing renderer; 3D uses Graph3DLazy).
6. [x] Build examples → _site and browser-check the representative flows.
7. [x] Run typecheck, lint, affected tests, and hosted CI.
8. [x] Deliver through PR #329.

## Current status
- Phase: COMPLETED in PR #329. The notes below preserve the implementation
  path and the mid-session checkpoint that preceded final delivery.
- Confirmed working on graph-view-static: 2D/3D toggle, node summary card (title+community+degree), 3D lazy load. User approved the pattern + EX-13/EX-19 fixes.
- Theming plan:
  - GraphView (SVG) → namespaced CSS vars `--fortemi-graph-*` with fallbacks (auto-themes; react rebuild).
  - Sigma/3D → explicit light/dark `theme` props via `graphThemeFor(mode)` in _shared/ui.
  - `examples/_shared/theme.css` → page vars (light `:root` + dark `:root[data-theme=dark]` + `@media prefers-color-scheme`).
  - ThemeToggle + `initTheme` (localStorage `fortemi-theme`, system default) in _shared/ui; classy sun/moon pill.
  - Make GraphModeToggle/NodeSummaryCard use CSS vars.
  - Palette map (light→var): #f4f1ea=--bg, #2b2824=--ink, #6e665a=--muted, #faf8f4=--surface, #fff=--surface-2, #ddd6c8=--rule, #43403a=--ink-strong, #585149=--accent, #e9e4d8=--code-bg, #b9946a=--warm.
- Checkpoint next action (completed later in PR #329): var-ify GraphView.tsx
  colors, build the shared theme controls, and fan out toggle/popup/theme
  behavior across the gallery.

## Historical graph-view-static checkpoint
- Shared: examples/_shared/theme.css (vars light/dark + system), examples/_shared/ui.tsx now also exports ThemeToggle (floating ☀/◐/☾), initTheme, useThemeMode, setThemePreference, graphThemeFor(mode).
- GraphView (react) themes via `--fortemi-graph-*` CSS vars (rebuilt react dist confirmed).
- graph-view-static: main.tsx imports theme.css + initTheme(); App renders `<ThemeToggle floating/>`, passes graphThemeFor(mode).force3d to Graph3DLazy; styles.css var-ified via /tmp/theme-varify.sed.
- Verified: build ✓ (theme vars in _site CSS), typecheck ✓ (added @types/react to _shared). Toggle renders ☀ Light/◐ System/☾ Dark. NOT visually confirmed (Playwright handed to another agent — do NOT use it).
- Reusable sed map for CSS fanout: /tmp/theme-varify.sed.

## Historical interrupted-session state
DONE at that checkpoint in the working tree (then delivered in PR #329):
- Shared: examples/_shared/{theme.css, ui.tsx (+ ThemeToggle/initTheme/useThemeMode/graphThemeFor/GraphModeToggle/Graph3DLazy/GraphNodeSummary), package.json (exports ./ui ./theme.css; deps @fortemi/react, react, @types/react)}.
- react: GraphView.tsx var-ified (rebuilt dist).
- ALL 17 React examples: main.tsx theme.css import + initTheme(); App.tsx `<ThemeToggle floating/>` + import; styles.css var-ified. (base theme = DONE everywhere)
- graph-view-static: FULLY wired (2D/3D toggle + GraphNodeSummary + graphThemeFor.force3d). Confirmed by user visually.
- Deps added+installed: 3D peers on aiwg-index-map/knowledge-garden/notes-graph-explorer/research-workbench/graph-2d-live; examples-shared on docs-atlas/snapshot-baking; react on custom-canvas-renderer.

Remaining at that checkpoint (subsequently completed in PR #329):
- graph-2d-live: needs 2D/3D toggle (Sigma↔Graph3DLazy) + graphThemeFor .sigma/.force3d + GraphNodeSummary.
- graph-3d-orbit: needs 2D option (GraphView↔ForceGraph3DView) + graphThemeFor.force3d (replace hardcoded '#14120f') + GraphNodeSummary.
- aiwg-index-map / knowledge-garden / notes-graph-explorer / research-workbench: SVG w/ existing rich detail panels → add 2D/3D toggle (GraphView↔Graph3DLazy) + graphTheme.force3d to 3D; KEEP existing detail panels (no GraphNodeSummary). GraphView auto-themes.
- custom-canvas-renderer / graph-controls-playground: multi-renderer → pass graphThemeFor .sigma/.force3d to their Sigma/3D instances (charts theme); GraphView auto. Add GraphNodeSummary only if selection display is minimal.
- DASHBOARD (build-site.mjs renderIndex): currently dark-only (:root{color-scheme:dark; --bg/--panel/--text/--muted/--accent...}). Add light+dark var sets + a vanilla theme toggle writing localStorage 'fortemi-theme' (same key as examples) + data-theme on <html>.
- graph-svg-vanilla (main.ts, VANILLA no React): import theme.css + a vanilla toggle; var-ify its SVG colors if feasible.
- FINAL: full build _site, typecheck, lint; NEW branch + PR (features/theme) separate from bug PR #329.

## Historical fanout plan (completed in PR #329)
Do toggle + popup + theme in ONE pass per example to avoid re-touching files:
- 7 single-renderer graph examples get 2D/3D toggle: graph-view-static ✓done, aiwg-index-map, knowledge-garden, notes-graph-explorer, research-workbench (SVG); graph-2d-live (Sigma→add 3D); graph-3d-orbit (3D→add 2D).
- 2 multi-renderer (custom-canvas-renderer, graph-controls-playground): node popup + theme only (already have 2D/3D).
- ALL ~18 examples (graph + non-graph): theme.css import + initTheme + `<ThemeToggle floating/>` + var-ify styles.css (sed) + remove `:root{color-scheme:light}`.
- Each example gaining 3D needs react-force-graph-3d + three deps (graph-view-static done).
- Sigma examples: pass graphThemeFor(mode).sigma to SigmaGraphView theme. 3D: pass .force3d.
- After fanout: full build _site, typecheck, lint, then new branch + PR (separate from bug-fix PR #329).

## Failed approaches (do not retry)
- Worker-mode / precompiled-wasm for EX-13/EX-19 was a SEPARATE (completed) bug fix — not part of this feature. Do not reopen.
- Public `@fortemi/react` component for the card: user chose "match reference" (app-level), and references build it app-side → keep it in examples/_shared, not published API (avoids parity/public-surface risk).

## State references
- Delivery PR: #329 (merged as `6c01228`)
- Reference source: /srv/vmshare/dev-inbox/jmagly/{magly.net,pagenary}

## Final delivery

- COMPLETE. PR #329 merged to `main` as `6c01228`.
- The merged change includes the shared theme/control layer, 2D/3D graph
  switching, node summaries, vanilla SVG theming, and the final Sigma/theme
  corrections across the examples gallery.
- The originally separate fix and feature scopes were reviewed and delivered
  together in PR #329; no source changes remain stranded in the old worktree.
