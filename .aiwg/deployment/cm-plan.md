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
- `package.json` version field
- Git tags: `v2026.3.0` (with `v` prefix)

**Version bump workflow**:
1. Update `package.json` version
2. Commit: `chore: bump version to 2026.3.1`
3. Tag: `git tag v2026.3.1`
4. Push: `git push && git push --tags`

---

## 3. Gitea Actions CI/CD Pipeline

### 3.1 Workflow Files

Location: `.gitea/workflows/`

### 3.2 CI Workflow (`.gitea/workflows/ci.yml`)

Triggered on: push to `main`, pull request to `main`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx tsc --noEmit

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx eslint src/ tests/

  unit-tests:
    runs-on: ubuntu-latest
    needs: [typecheck, lint]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:format-parity
      - run: npm run test:integration
      - run: npm run test:coverage
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  build:
    runs-on: ubuntu-latest
    needs: [unit-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run build
      - name: Check bundle size
        run: |
          BUNDLE_SIZE=$(du -sk dist/ | cut -f1)
          echo "Bundle size: ${BUNDLE_SIZE}KB"
          # Rough check — detailed analysis via bundle analyzer
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  e2e-chromium:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - run: npm run test:e2e -- --project=chromium

  e2e-firefox:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install firefox --with-deps
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - run: npm run test:e2e -- --project=firefox
```

### 3.3 Release Workflow (`.gitea/workflows/release.yml`)

Triggered on: push of tag matching `v*`

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run build
      - name: Create Gitea Release
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          # Create release with dist/ artifact
          # Using Gitea API or gh CLI equivalent
```

---

## 4. Environment Configuration

### 4.1 Development

```bash
npm run dev          # Vite dev server on :5173
```

**Required for dev** (set in `.env.local`):
```
VITE_APP_VERSION=2026.3.0-dev
```

**Vite configuration** (required for PGlite):

`vite.config.ts`:
```typescript
// Errata #4/#5: COOP/COEP headers NOT required (PGlite uses OPFS sync handles, not SharedArrayBuffer)
{
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' }
}
```

### 4.2 Production Build

```bash
npm run build        # Vite build → dist/
npm run preview      # Preview production build on :4173
```

**Production environment** (set at build time):
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

`package-lock.json` committed. `npm ci` used in all CI steps (not `npm install`).

### 5.2 Dependency Update Policy

- Security updates: Apply immediately; patch release
- Minor updates: Evaluate monthly; patch or minor release
- Major updates: Evaluate quarterly; minor or major release
- PGlite updates: Follow Electric SQL releases; test migration compatibility

### 5.3 License Audit

AGPL-3.0 license requires all production dependencies to be compatible. License check in CI:
```bash
npx license-checker --production --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0"
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
| `dist/` | Gitea release asset | Per release tag |
| Coverage reports | CI artifact | 30 days |
| Playwright test reports | CI artifact | 30 days |
| E2E screenshots (failure) | CI artifact | 30 days |
| Server fixtures | `tests/fixtures/server/` | In repo |
