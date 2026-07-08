# fortemi-react SDLC Checkpoint - 2026-07

## Phase Read

`fortemi-react` has a mature local-first SDLC corpus. The enterprise/backoffice phase should not accidentally turn this package set into a hosted-only or private-EE dependency path.

## Key Findings

- Existing ADRs cover PGlite storage, capability modules, service worker API, public API first, and pluggable storage.
- The package can support shared component/type work, but its local-first and public package boundaries must stay explicit.

## Required Work

- Use filed issue `Fortemi/fortemi-react#246` as the premium-component boundary tracker.
- Use `.aiwg/architecture/premium-backoffice-boundary-2026-07.md` as the boundary decision for premium/backoffice concepts.
- Preserve local-first operation and public-package constraints.
- Keep `Fortemi/fortemi-react#252` separate from premium-boundary planning: release metadata/docs/manifests/exported constants are locally reconciled for `2026.7.3`, but tracker update/acceptance remains an administrative gate.
- Keep React binary parity/export closure separate from package-boundary planning until `Fortemi/fortemi#1013` and the companion `Fortemi/fortemi-react#227` parity/export blocker close or are explicitly accepted.

## Enterprise Boundary No-Go Rules

- Do not import private Enterprise Edition crates, private generated clients, hosted tenant admin APIs, KMS/RBAC/billing/audit APIs, or server-side license enforcement into `@fortemi/core`, `@fortemi/graph`, or `@fortemi/react`.
- Do not require private package registry credentials, hosted auth, tenant context, or a managed Fortemi service for local package install, test, or runtime operation.
- Do not treat generic preview or disabled-state UI helpers as proof of production backoffice workflows.
- Do not use `fortemi-react` package release availability as proof that the Fortemi binary attachment projection contract is closed.

## Exit Criteria For `Fortemi/fortemi-react#246`

- The premium/backoffice boundary decision is accepted by the package owner or operator.
- Any introduced shared types remain public, backend-agnostic, and safe for local-first consumers.
- Package architecture docs link to the boundary decision and explain the allowed coarse capability metadata surface.
- HotM or Fortemi consumers reference only public metadata or generic UI helpers from this repo until backend contracts and production evidence exist elsewhere.
- No new package dependency path requires private registry credentials or hosted Fortemi services.

## Added Artifacts

- `.aiwg/architecture/premium-backoffice-boundary-2026-07.md`
