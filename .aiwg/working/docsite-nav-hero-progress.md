# Progress: fortemi-react docsite — hero landing + progressive nav + move design docs to .aiwg

## Task contract
- User asks: (1) add a hero/landing page like the fortemi **server** docs; (2) reorganize the
  docbase nav to guide new users first, advanced topics in dedicated sections further down;
  (3) move planning/design/spec docs out of `docs/` into `.aiwg/` — `docs/` = consumer docs only.
- Completion criteria: `docsite/dist/fortemi-react` builds clean (0 broken links); site landing =
  the overview hero (not an alphabetical page); nav in progressive order with dedicated groups;
  design docs relocated to `.aiwg/architecture/`; then commit to main (no AI attribution) + push
  origin (Gitea) + republish via `docsite-deploy.yml` workflow_dispatch.
- Authorization: user explicitly authorized direct commit to main + republish.

## Key mechanism discovered (Pagenary 2026.7.3)
- `findContentRoot`: if a `content/` subdir exists → **flat/legacy manifest-driven** mode
  (honors manifest `default`, `order`, and nested `sections` grouping; routes = section ids).
- Otherwise, subdirs present → **nested** mode: nav auto-derived from directory tree, sorted
  ALPHABETICALLY; manifest `default`/`order` IGNORED; landing = alphabetically-first entry.
- The fortemi **server** uses `docs/content/` → that's why its manifest hero/nav works.
- FIX: move react content under `docs/content/` to match the server → manifest fully honored.

## Done
- [x] Blog post + Pagenary 2026.7.3 + presentation config (prior session, on main already).
- [x] Moved design/spec docs docs/architecture/*.md → .aiwg/architecture/ (7 files). Removed the
      internal Package-Architecture link from packages/graph/README.md.
- [x] Created docs/overview.md (hero + banner frontmatter, consumer overview).
- [x] Reorganized content into guides/ + advanced/ subdirs (nested attempt — superseded).

## Current step: migrate to docs/content/ (server model)
1. git mv content (overview, getting-started, api-reference, guides/, advanced/, security/,
   releases/, posts/) into docs/content/. config.json + manifest.json STAY in docs/.
2. prebuild-packages.mjs outDir docs/packages → docs/content/packages; .gitignore likewise.
3. Blob links in packages READMEs: blob/main/docs/ → blob/main/docs/content/.
4. manifest.json: nested groups (Welcome/Getting Started/Guides/API/Packages/Advanced/Security/
   Releases), default "welcome", file paths incl guides//advanced/ prefixes, section-id routes.
5. overview.md anchors → section-id form (#getting-started, #guides-integration, #api-reference,
   #packages-core, #advanced-extending, /blog).
6. build → verify DEFAULT_SECTION=welcome/overview, nav order, 0 broken links, blog present.
   (Empirically confirm runtime route-id scheme from built manifest.js; fix anchors if needed.)

## Then
- Commit to main (NO AI attribution), push origin (Gitea), republish via docsite-deploy workflow_dispatch.

## COMPLETE
- [x] content/ migration → manifest-driven. Verified build: DEFAULT_SECTION=overview (hero landing,
      full-bleed pe-hero band), nav in progressive order (Welcome→Getting Started→Guides→API→
      Packages→Advanced→Security→Releases→Blog), 0 broken links, blog index+feed present.
- [x] Committed to main: 7ec49fd "docs(site): add hero landing, progressive nav, move design docs
      to .aiwg" (no AI attribution). Pushed origin (Gitea): 018a20c..7ec49fd.
- [x] docsite-deploy: run 200 failed (transient deploy-phase hang, ~14.5m→15m timeout; log lost).
      Re-dispatched → run 201 = SUCCESS (incl. SSH verify index.html live on docs server).
      (Run 199 = unrelated push code-CI; its typecheck/e2e failures pre-date this docs-only commit.)
- Unrelated dirty files (.aiwg/activity.log, .aiwg/aiwg.config, AIWG.md) left uncommitted by design.

## Failed approaches (do not retry)
- Setting manifest `default`/`order` while docs are NESTED (subdirs at docs/ root): IGNORED by
  Pagenary — landing stays alphabetical-first (advanced/deployment), nav stays alphabetical.
- Renaming to index.md: index.md is skipped in leaf scan / maps to parent dir id.
