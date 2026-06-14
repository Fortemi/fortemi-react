# Doc Sync Audit - 2026-06-14

Direction: code-to-docs

Scope:
- `packages/**`
- `apps/**`
- `docs/**`
- `README.md`
- `CHANGELOG.md`

## Findings

- `FortemiProvider` gained worker-mode PGlite support. `docs/integration.md` already documented `executionMode` and `createWorker`; package README coverage was stale and has been updated.
- Knowledge Shard import/export gained chunked progress, yielding, set-scoped export, and lazy/paged vector behavior. Package README and release notes now document the shipped behavior.
- The standalone app gained bridge-safe provider configuration and docs seeding. `CHANGELOG.md`, release notes, and package README storage guidance now reflect secure-storage-only credential persistence.
- AIWG index graph projection and `GraphView` were implemented. The AIWG CRM integration guide and React README now document graph projection and review usage.
- The standalone default docs corpus now includes the `v2026.6.1` release note so the default UX can index the current release documentation.

## Result

Code-to-docs drift found and reconciled for the release surface. No docs-to-code changes were needed.
