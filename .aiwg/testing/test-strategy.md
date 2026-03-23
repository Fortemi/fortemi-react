# Test Strategy — fortemi-react

**Version**: 2026.3.0
**Author**: roctinam + Test Engineer (agent)
**Status**: Baselined
**Frameworks**: Vitest 4.x (unit/integration), Playwright 1.x (E2E) <!-- Errata #4: Vitest 2.x → 4.x -->
**CI**: Gitea Actions

---

## 1. Testing Philosophy

The most critical test category for fortemi-react is **format parity** — ensuring that JSON serializations match the fortemi server exactly. A passing test suite that fails format parity is a failing test suite.

Test pyramid (priority order):
1. **Format parity round-trip tests** — critical path, blocks merge
2. **Repository unit tests** — SQL correctness, business rules
3. **Worker integration tests** — PGlite Worker message protocol
4. **Service Worker / MCP tool tests** — REST API surface
5. **Playwright E2E tests** — user flows and browser compatibility

---

## 2. Test Levels

### 2.1 Unit Tests (Vitest)

**Scope**: Repository layer, business logic, utility functions, serializers

**Location**: `packages/core/src/__tests__/*.test.ts`

**Coverage Target**: 88% statements overall; 96% for repository layer (achieved)

**Key test suites** (27 files, 603 tests):

| Suite | File | Lines | Priority |
|---|---|---|---|
| `job-queue-worker.test.ts` | Job queue lifecycle, priority ordering, retry logic | 904 | CRITICAL |
| `tools-extended.test.ts` | Extended MCP tool request/response shapes | 783 | CRITICAL |
| `notes-repository.test.ts` | CRUD, soft-delete, UUIDv7 generation | 695 | CRITICAL |
| `embedding-pipeline.test.ts` | Chunk splitting, embedding dispatch, deduplication | 626 | CRITICAL |
| `tools.test.ts` | Core MCP tool shapes (all 38 tools) | 464 | CRITICAL |
| `worker-client.test.ts` | PGlite Worker message protocol, postMessage round-trips | 385 | CRITICAL |
| `search-repository.test.ts` | FTS query construction, RRF fusion logic | 379 | CRITICAL |
| `capability-manager.test.ts` | Module registration, state machine | 350 | HIGH |
| `sw-routes.test.ts` | Service Worker route handling, activation, update drain | 296 | HIGH |
| `attachments-repository.test.ts` | Reference counting, GC trigger | 295 | HIGH |
| `event-bus.test.ts` | Event subscription, dispatch, unsubscribe | 280 | HIGH |
| `collections-repository.test.ts` | Collection CRUD, parent/child hierarchy | 276 | HIGH |
| `tool-manifest.test.ts` | Tool manifest schema validation | 273 | HIGH |
| `skos-repository.test.ts` | SKOS scheme/concept CRUD, relations | 268 | HIGH |
| `migration-runner.test.ts` | Sequential migration application, rollback | 251 | CRITICAL |
| `gpu-detect.test.ts` | GPU capability detection, fallback logic | 245 | HIGH |
| `links-repository.test.ts` | Note link CRUD, bidirectional queries | 195 | HIGH |
| `archive-manager.test.ts` | Archive switch, isolation, db_path management | 187 | HIGH |
| `tags-repository.test.ts` | Tag CRUD, source tracking | 185 | HIGH |
| `service-worker-register.test.ts` | SW registration lifecycle | 142 | MEDIUM |
| `blob-store.test.ts` | Blob storage, content-hash keying | 97 | HIGH |
| `create-fortemi.test.ts` | Top-level factory function | 96 | MEDIUM |
| `db.test.ts` | Database initialization, connection lifecycle | 89 | MEDIUM |
| `hash.test.ts` | BLAKE3 (@noble/hashes) → SHA-256 (Web Crypto) fallback chain | 67 | MEDIUM | <!-- Errata #2: renamed from blake3.fallback; uses @noble/hashes not blake3-wasm -->
| `uuid.test.ts` | UUIDv7 format validation | 48 | HIGH |

**Run command**:
```bash
pnpm test:core
```

**Watch mode** (dev):
```bash
pnpm vitest
```

---

### 2.2 Format Parity Tests (Vitest — critical category)

**Scope**: Every table's JSON serialization compared against server fixture files

**Location**: `packages/core/src/__tests__/format-parity/`

**Files**:
- `format-parity.test.ts` (186 lines) — one test per table, 21 tables total
- `helpers.test.ts` (52 lines) — fixture loading and shape matching utilities

**Test pattern**:
```typescript
// For each table, the pattern is:
// 1. Load a server fixture (JSON exported from fortemi server)
// 2. Import via browser repository
// 3. Export via browser repository
// 4. Assert deep equality against original fixture
test('note round-trip parity', async () => {
  const fixture = await loadServerFixture('note_full.json');
  const noteId = await notesRepo.import(fixture);
  const exported = await notesRepo.get(noteId);
  expect(exported).toMatchServerShape(fixture);
});
```

**Tables covered** (one test per table, 21 total):

| Fixture | Fields Validated |
|---|---|
| `note_full.json` | id (UUIDv7), format, source, visibility, created_at_utc (ISO 8601), deleted_at |
| `note_original.json` | note_id, content, hash (SHA-256 format) |
| `note_revised_current.json` | note_id, content, ai_metadata, generation_count, model |
| `note_revision.json` | id, note_id, revision_number, type, content |
| `attachment.json` | id, note_id, blob_id, status, extraction_strategy |
| `attachment_blob.json` | id, content_hash (blake3: or sha256: prefix), storage_backend |
| `embedding.json` | id, note_id, chunk_index, model, vector (768 dimensions) |
| `embedding_set.json` | id, name, type, mode, index_status |
| `skos_scheme.json` | id, name |
| `skos_concept.json` | id, scheme_id, notation, pref_label |
| `skos_concept_relation.json` | source_id, target_id, relation_type, strength |
| `note_tag.json` | note_id, tag_name, source |
| `note_skos_tag.json` | note_id, concept_id, confidence, relevance_score, is_primary |
| `link.json` | id, from_note_id, to_note_id, kind, score |
| `provenance_edge.json` | id, revision_id, source_note_id, relation |
| `collection.json` | id, name, parent_id, created_at_utc |
| `archive.json` | id, name, db_path, schema_version |
| `job_queue.json` | id, note_id, job_type, status, priority, retry_count |
| `document_type.json` | id, slug, category, extraction_strategy |
| `api_key.json` | id, key_hash (never plain), scopes, expires_at |
| `search_response.json` | notes (NoteSummary[]), semantic_available, mode |

**Server fixtures location**: `packages/core/src/__tests__/format-parity/fixtures/` (exported from fortemi server)

**Run command**:
```bash
pnpm vitest run packages/core/src/__tests__/format-parity/
```

---

### 2.3 Integration Tests (Vitest + PGlite in-memory)

**Scope**: PGlite Worker message protocol; migration runner; multi-step database operations

**Location**: `packages/core/src/__tests__/` (co-located with unit tests; integration-focused suites listed below)

**Key suites**:

| Suite | Description |
|---|---|
| `worker-client.test.ts` | Full Worker lifecycle; postMessage round-trips |
| `migration-runner.test.ts` | 0001 → current migration sequence; schema validation |
| `job-queue-worker.test.ts` | Job insertion → processing → completion cycle |
| `search-repository.test.ts` | FTS + vector + RRF on real PGlite instance |
| `capability-manager.test.ts` | Capability enable → job requeue flow |

**PGlite config for tests**: In-memory (not OPFS) to avoid test isolation issues:
```typescript
const db = new PGlite(); // no opfs:// prefix = in-memory
```

---

### 2.4 Service Worker / MCP Tests (Vitest)

**Scope**: MCP tool request/response format; REST endpoint correctness; SW route handling

**Location**: `packages/core/src/__tests__/` (co-located; SW/tool-focused suites listed below)

**Key suites**:

| Suite | File | Description |
|---|---|---|
| `tools.test.ts` | `packages/core/src/__tests__/tools.test.ts` | Core MCP tool request/response shapes |
| `tools-extended.test.ts` | `packages/core/src/__tests__/tools-extended.test.ts` | Extended tool coverage |
| `tool-manifest.test.ts` | `packages/core/src/__tests__/tool-manifest.test.ts` | Tool manifest schema |
| `sw-routes.test.ts` | `packages/core/src/__tests__/sw-routes.test.ts` | SW route handling, activation |
| `service-worker-register.test.ts` | `packages/core/src/__tests__/service-worker-register.test.ts` | SW registration lifecycle |

---

### 2.5 E2E Tests (Playwright)

**Scope**: Full user flows in real browsers; offline mode; capability module UX; browser compatibility matrix

**Location**: `apps/standalone/e2e/`

**Files** (16 tests, 4 tests × 2 browsers each):

| File | Tests | Description |
|---|---|---|
| `smoke.test.ts` | 4 × 2 browsers | App loads, basic navigation, no JS errors |
| `loading.test.ts` | 4 × 2 browsers | Loading states, initial data fetch, capability gate display |

**Browser matrix**:
```javascript
// playwright.config.ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  // Safari: via webkit on macOS runners
]
```

**Key test flows**:

| Flow | Steps | Assertions |
|---|---|---|
| Note creation | Open app → create note → verify | Note visible; jobs queued; format parity |
| FTS search | Create 5 notes → search → verify results | Correct ranking; deleted notes excluded |
| Offline create | Disable network → create note → restore → verify | Note persisted in OPFS |
| Archive switch | Create archives → switch → verify isolation | Notes from other archive not visible |
| MCP tool flow | Configure MCP client → call `capture_knowledge` → verify | Tool result matches expected format |
| Capability UX | Enable semantic → download → verify progress | Progress bar shown; cancel works |

**Performance tests** (Playwright):
```typescript
test('FTS search < 500ms', async ({ page }) => {
  await seedNotes(page, 10000);
  const start = Date.now();
  await page.fill('[data-testid=search-input]', 'rust memory safety');
  await page.waitForSelector('[data-testid=search-results]');
  expect(Date.now() - start).toBeLessThan(500);
});
```

**Run command**:
```bash
pnpm playwright test --project=chromium
pnpm playwright test --project=firefox
```

---

## 3. CI Pipeline (Gitea Actions)

```yaml
# .gitea/workflows/ci.yml

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

**Required checks to pass before merge**:
1. `typecheck`
2. `lint`
3. `unit-test` (includes format parity)
4. `build`

---

## 4. Test Data and Fixtures

### Server Fixtures

Server fixture files are exported from the fortemi server and committed to `packages/core/src/__tests__/format-parity/fixtures/`. They represent canonical JSON shapes that browser output must match.

**Fixture generation** (from server):
```bash
# On fortemi server:
cd ~/dev/fortemi/fortemi
cargo run --bin export-fixtures -- tests/fixtures/ --all-tables
```

**Fixture update policy**: Server fixture files are updated when the server schema changes (new migration). Browser format parity tests must pass after fixture update before the migration is considered implemented.

### Test Database Seeds

Large test datasets (10k notes for performance tests) are generated programmatically, not committed:
```typescript
// packages/core/src/__tests__/helpers/seed.ts
export async function seedNotes(db: PGlite, count: number) {
  // Batch insert using COPY protocol for speed
}
```

---

## 5. Coverage Targets

Actual coverage achieved as of C3 (vitest --coverage):

| Layer | Achieved | Target | Tool |
|---|---|---|---|
| Overall statements | 88.56% | 85% | `@vitest/coverage-v8` |
| Overall branches | 86.4% | 80% | `@vitest/coverage-v8` |
| Overall functions | 85.82% | 80% | `@vitest/coverage-v8` |
| Overall lines | 90.24% | 85% | `@vitest/coverage-v8` |
| Repository layer (statements) | 96.89% | 90% | `@vitest/coverage-v8` |
| Repository layer (branches) | 89.67% | 85% | `@vitest/coverage-v8` |
| Migrations | 100% | 100% | `@vitest/coverage-v8` |
| Tools | 96.61% | 90% | `@vitest/coverage-v8` |
| Worker | 97.77% | 90% | `@vitest/coverage-v8` |
| Service Worker | 100% | 95% | `@vitest/coverage-v8` |
| Capabilities | 84.7% | 80% | `@vitest/coverage-v8` |
| Format parity | 100% (all 21 tables) | 100% | Vitest |
| E2E critical paths | Manual checklist | Manual checklist | Playwright |

**Coverage command**:
```bash
pnpm vitest run --coverage --reporter=text --reporter=lcov
```

**Coverage threshold** (vitest.config.ts):
```typescript
coverage: {
  thresholds: {
    lines: 85,
    functions: 80,
    branches: 80,
    statements: 85,
  }
}
```

---

## 6. Testing Philosophy for Edge Cases

### Offline Mode

All core tests must pass with network disabled. Use Playwright `context.setOffline(true)` for E2E. For unit/integration tests, PGlite in-memory naturally operates offline.

### Browser Compatibility

Playwright runs against chromium (required), firefox (required). Safari/WebKit tested manually or optionally in CI if macOS runner available. iOS explicitly out of scope v1.

### WASM Testing

Capability modules (transformers.js, WebLLM) are mocked in unit/integration tests. Playwright E2E tests use real capability downloads only in dedicated slow-test suites (not in fast CI path).

### Concurrency

PGlite Worker message queue is tested with concurrent request bursts to validate serialization correctness.
