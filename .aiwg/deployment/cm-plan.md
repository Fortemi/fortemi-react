# Configuration Management Plan — fortemi-browser

**Version**: 2026.3.0
**Author**: roctinam
**Status**: Baselined
**CI/CD**: Gitea Actions
**Repository**: `git.integrolabs.net:Fortemi/fortemi-browser.git`

---

## 1. Version Control

### 1.1 Repository

- **Platform**: Gitea at `git.integrolabs.net`
- **Organization**: Fortemi
- **Repository**: `fortemi-browser`
- **Default branch**: `main`
- **Remote**: `origin`

### 1.1a Monorepo Structure

fortemi-browser is a pnpm monorepo with three packages:

| Package | Name | Contents |
|---|---|---|
| `packages/core` | `@fortemi/core` | Repositories, migrations, workers, tools, tests |
| `packages/react` | `@fortemi/react` | Hooks, FortemiProvider |
| `apps/standalone` | `@fortemi/standalone` | Vite 7.3.1 + React 19.2.4 application |

The workspace root (`fortemi-browser`) holds the `pnpm-workspace.yaml`, root `package.json`, and shared tooling configuration. All workspace packages are managed via pnpm workspaces.

### 1.2 Branching Strategy

**GitHub Flow** (simple, appropriate for solo developer):

```
main ← always deployable
  ├── feature/phase-1-pglite-worker
  ├── feature/phase-1-migration-runner
  ├── fix/schema-version-tracking
  └── chore/update-dependencies
```

**Branch naming conventions**:
| Prefix | Usage |
|---|---|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `chore/` | Dependencies, tooling, non-functional |
| `poc/` | Proof-of-concept (may not merge) |
| `docs/` | Documentation only |

### 1.3 Commit Conventions

**Conventional Commits** format:
```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

Scopes: `worker`, `migrations`, `repository`, `search`, `sw`, `capabilities`, `ui`, `mcp`, `attachments`

No AI attribution in commit messages (per `no-attribution` rule).

---

## 2. Versioning

**CalVer format**: `YYYY.M.PATCH` — NO leading zeros

Examples:
- First release March 2026: `2026.3.0`
- Second patch: `2026.3.1`
- April release: `2026.4.0`

**Enforced in**:
- `package.json` version field (workspace root and all packages)
- Git tags: `v2026.3.0` (with `v` prefix)

**Version bump workflow**:
1. Update `package.json` version in the workspace root and affected packages
2. Commit: `chore: bump version to 2026.3.1`
3. Tag: `git tag v2026.3.1`
4. Push: `git push && git push --tags`

---

## 3. Gitea Actions CI/CD Pipeline

### 3.1 Workflow Files

Location: `.gitea/workflows/`

### 3.2 CI Workflow (`.gitea/workflows/ci.yml`)

Triggered on: push to any branch, pull request to `main`

```yaml
name: CI

on:
  push:
    branches: ['*']
  pull_request:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:core

  build:
    runs-on: ubuntu-latest
    needs: [typecheck, lint, unit-test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
```

### 3.3 Release Workflow (`.gitea/workflows/release.yml`)

**Not yet implemented.** A release workflow triggered on `v*` tag pushes is planned but does not currently exist in `.gitea/workflows/`. Version releases are currently managed manually: build locally, tag, push, and attach the `apps/standalone/dist/` artifact to the Gitea release via the UI or API.

---

## 4. Environment Configuration

### 4.1 Development

```bash
pnpm dev             # Vite dev server on :5173 (runs @fortemi/standalone)
pnpm test:core       # Run @fortemi/core tests
pnpm typecheck       # Type-check all packages
pnpm lint            # ESLint across the workspace
```

**Required for dev** (set in `.env.local` under `apps/standalone`):
```
VITE_APP_VERSION=2026.3.0-dev
```

**Vite configuration** (required for PGlite):

`apps/standalone/vite.config.ts`:
```typescript
// Errata #4/#5: COOP/COEP headers NOT required (PGlite uses OPFS sync handles, not SharedArrayBuffer)
{
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' }
}
```

### 4.2 Production Build

```bash
pnpm build           # Builds all packages recursively (pnpm -r build)
```

The standalone app output lands in `apps/standalone/dist/`.

**Production environment** (set at build time in `apps/standalone`):
```
VITE_APP_VERSION=2026.3.0
```

### 4.3 No Server Required

fortemi-browser is a static web application. It can be served by:
- Any static file server
- GitHub/Gitea Pages
- Netlify, Vercel, Cloudflare Pages
- `python -m http.server` for local distribution

**Required headers**: None — PGlite 0.4.1 does not require COOP/COEP headers (see Errata #5). Any static file server works out-of-box.

---

## 5. Dependency Management

### 5.1 Lockfile

`pnpm-lock.yaml` is committed. `pnpm install --frozen-lockfile` is used in all CI steps to guarantee reproducible installs. Do not commit `package-lock.json` or `yarn.lock`.

### 5.2 Dependency Update Policy

- Security updates: Apply immediately; patch release
- Minor updates: Evaluate monthly; patch or minor release
- Major updates: Evaluate quarterly; minor or major release
- PGlite updates: Follow Electric SQL releases; test migration compatibility

### 5.3 License Audit

AGPL-3.0 license requires all production dependencies to be compatible. License check:
```bash
pnpm dlx license-checker --production --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0"
```

---

## 6. Migration Versioning

Browser migrations are numbered sequentially:
```
migrations/0001_initial_schema.sql
migrations/0002_skos_tagging.sql
...
```

**Rules**:
- Never modify an existing migration after it has been applied to any database
- Never reuse a migration number
- Never delete a migration
- Treat migrations as append-only historical record
- New migrations bump the PATCH version (at minimum)

---

## 7. Artifact Management

| Artifact | Location | Retention |
|---|---|---|
| `apps/standalone/dist/` | Gitea release asset | Per release tag |
| Coverage reports | CI artifact | 30 days |
| Playwright test reports | CI artifact | 30 days |
| E2E screenshots (failure) | CI artifact | 30 days |
| Server fixtures | `packages/core/tests/fixtures/` | In repo |
