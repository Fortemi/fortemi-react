# fortemi-react Issue Drafts - SDLC Checkpoint 2026-07

## 1. Define shared premium-component compatibility responsibilities

**Filed:** `Fortemi/fortemi-react#246`

**Labels:** `sdlc/checkpoint`, `premium-components`, `planning`

### Problem

The enterprise/backoffice phase may introduce shared premium component concepts across HotM, Fortemi, and browser-local packages. `fortemi-react` needs an explicit boundary so browser-local capabilities are not accidentally coupled to hosted-only enterprise APIs.

### Acceptance Criteria

- Document which premium/backoffice concepts are in scope for `fortemi-react`, if any.
- Preserve local-first operation and AGPL/public package constraints.
- Identify reusable UI/types that can be shared without private EE dependencies.
- Add compatibility notes to package architecture docs if shared types are introduced.
- Confirm no package install, test, or runtime path requires private registry credentials, hosted auth, tenant context, KMS, RBAC, billing, audit services, or license enforcement.
- Confirm any shared capability type is public and backend-agnostic, with unknown/hosted-only state degrading to disabled or preview.
- Keep release metadata/docs reconciliation for `Fortemi/fortemi-react#252` and binary parity/export closure for `Fortemi/fortemi#1013`/`Fortemi/fortemi-react#227` out of this issue's closure criteria.

### Boundary Artifact

- `.aiwg/architecture/premium-backoffice-boundary-2026-07.md`

### No-Go Boundary

This issue must not authorize private EE imports, hosted tenant-admin APIs, private generated clients, server-side license enforcement, or production backoffice workflows inside `fortemi-react`. Those remain owned by `fortemi`, `HotM`, `fortemi-auth`, `licensing`, and `Fortemi-Enterprise/*` until a future ADR accepts a specific public shared type.
