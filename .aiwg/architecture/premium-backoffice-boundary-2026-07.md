# Premium And Backoffice Boundary - 2026-07

## Purpose

Define what enterprise, premium, and backoffice concepts may enter `fortemi-react` during the Fortemi enterprise/backoffice phase without compromising the package set's local-first operation, public package posture, or TypeScript API boundaries.

## Decision

`fortemi-react` may model enterprise concepts only as public, coarse-grained capability metadata, preview-state types, and optional UI affordances that are useful to local-first consumers. It must not depend on private Enterprise Edition crates, hosted-only Fortemi APIs, private package registries, or server-side license enforcement.

Enterprise/backoffice implementation remains owned by `fortemi`, `HotM`, `fortemi-auth`, `licensing`, and `Fortemi-Enterprise/*` unless a future ADR accepts a specific shared public type into `fortemi-react`.

## In Scope

| Area | Allowed in `fortemi-react` | Rationale |
|---|---|---|
| Capability metadata types | Public enums/interfaces for available, unavailable, license-required, admin-required, preview-only, unknown. | Supports UI compatibility without private dependencies. |
| Local-first capability discovery | Existing `capabilities` surfaces may expose local feature availability. | Aligns with ADR-008 agent-discoverable capabilities. |
| Generic disabled-state UI helpers | Public React components or hooks that render disabled/degraded/preview states from public metadata. | Reusable by local-first apps and demos. |
| Graph/search/memory primitives | Existing CE package capabilities. | Core package mission. |
| Fixture-friendly preview states | Test-only/public fixtures that do not encode private license data. | Helps HotM and docs verify degraded states. |

## Out Of Scope

| Area | Reason |
|---|---|
| Private EE crate imports or generated clients from private APIs | Violates public package boundary and package distribution gate. |
| Hosted tenant admin APIs, audit sink APIs, KMS APIs, billing APIs, RBAC policy engines | Owned by `fortemi`/`Fortemi-Enterprise` and currently gated. |
| License verification or entitlement enforcement | Owned by licensing/enterprise backend; `fortemi-react` may show coarse status only. |
| Managed-service or CE-in-EE legal language | Owned by `licensing` and `fortemi.com` claim-control artifacts. |
| Production backoffice workflows | Owned by HotM/backoffice UX once backend contracts exist. |

## Package Boundary Rules

1. `@fortemi/core` remains public, local-first, and headless.
2. `@fortemi/graph` remains graph/projection focused and must not learn enterprise licensing or hosted auth semantics.
3. `@fortemi/react` may render generic capability/preview state components if they accept public metadata and remain usable without Fortemi hosted services.
4. No package may require private package registry credentials to install or test.
5. No package may require hosted auth, tenant context, KMS, RBAC, billing, or audit service availability for local operation.
6. Unknown enterprise capability state must degrade to disabled/preview, never enabled.

## Candidate Public Types

If shared types are needed, introduce them as generic capability status types rather than EE-specific objects:

```typescript
type CapabilityAvailability =
  | 'available'
  | 'unavailable'
  | 'license_required'
  | 'admin_required'
  | 'preview_only'
  | 'unknown';

interface CapabilityStatus {
  key: string;
  availability: CapabilityAvailability;
  displayName?: string;
  reasonCode?: string;
  documentationUrl?: string;
}
```

These types must not include:

- Raw license material.
- Entitlement tokens.
- Tenant secrets or raw tenant IDs.
- KMS key IDs or provider resource names.
- Private package coordinates.
- Internal RBAC policy expressions.

## Compatibility With HotM Enterprise UX

HotM may consume `fortemi-react` public helpers only for generic state rendering or local-first memory UI. HotM-specific enterprise surfaces remain in HotM:

- Connection and Compatibility Center.
- Hosted Auth Onboarding.
- Realtime Activity Drawer.
- Premium Components Catalog.
- Backoffice Console Preview.
- Fixture-backed enterprise demo runbook.

If HotM needs reusable components later, promote only public, backend-agnostic primitives into `fortemi-react`.

## Traceability

- Tracker: `Fortemi/fortemi-react#246`
- HotM blueprint: `HotM/.aiwg/design/enterprise-demo-screen-state-blueprint-2026-07.md`
- HotM requirements: `HotM/.aiwg/requirements/enterprise-demo-requirements-2026-07.md`
- Backoffice contract issue: `Fortemi/fortemi#1020`
- Package architecture: `.aiwg/architecture/package-architecture.md`

## Review Checklist

- A proposed `fortemi-react` change works without private EE packages.
- Local-first operation is preserved in all deployment modes.
- AGPL/public package posture is not weakened by private dependency assumptions.
- Unknown hosted/enterprise capability state disables controls by default.
- Any new type is generic enough for local/public consumers and documented in package architecture.
