# Test Strategy — fortemi-browser

**Version**: 2026.3.0
**Author**: roctinam + Test Engineer (agent)
**Status**: Baselined
**Frameworks**: Vitest 4.x (unit/integration), Playwright 1.x (E2E) <!-- Errata #4: Vitest 2.x → 4.x -->
**CI**: Gitea Actions

---

## 1. Testing Philosophy

The most critical test category for fortemi-browser is **format parity** — ensuring that JSON serializations match the fortemi server exactly. A passing test suite that fails format parity is a failing test suite.

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

**Location**: `src/**/__tests__/*.test.ts` or `src/**/*.test.ts`

**Coverage Target**: 60% overall; 80% for repository layer

**Key test suites**:

| Suite | Description | Priority |
|---|---|---|
| `notes.repository.test.ts` | CRUD, soft-delete, UUIDv7 generation | CRITICAL |
| `search.repository.test.ts` | FTS query construction, RRF fusion logic | CRITICAL |
| `migration.runner.test.ts` | Sequential migration application, rollback | CRITICAL |
| `capability.manager.test.ts` | Module registration, state machine | HIGH |
| `job.queue.test.ts` | Job insertion, priority ordering, retry logic | HIGH |
| `uuidv7.test.ts` | UUIDv7 format validation | HIGH |
| `hashing.test.ts` | BLAKE3 (@noble/hashes) → SHA-256 (Web Crypto) fallback chain | MEDIUM | <!-- Errata #2: renamed from blake3.fallback; uses @noble/hashes not blake3-wasm -->
| `attachment.blob.test.ts` | Reference counting, GC trigger | HIGH |

**Run command**:
```bash
vitest run
```

**Watch mode** (dev):
```bash
vitest
```

---

### 2.2 Format Parity Tests (Vitest — critical category)

**Scope**: Every table's JSON serialization compared against server fixture files

**Location**: `tests/format-parity/`

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

**Server fixtures location**: `tests/fixtures/server/` (exported from fortemi server)

**Run command**:
```bash
vitest run tests/format-parity/
```

---

### 2.3 Integration Tests (Vitest + PGlite in-memory)

**Scope**: PGlite Worker message protocol; migration runner; multi-step database operations

**Location**: `tests/integration/`

**Key suites**:

| Suite | Description |
|---|---|
| `pglite.worker.integration.test.ts` | Full Worker lifecycle; postMessage round-trips |
| `migration.integration.test.ts` | 0001 → current migration sequence; schema validation |
| `job.queue.integration.test.ts` | Job insertion → processing → completion cycle |
| `hybrid.search.integration.test.ts` | FTS + vector + RRF on real PGlite instance |
| `capability.integration.test.ts` | Capability enable → job requeue flow |

**PGlite config for tests**: In-memory (not OPFS) to avoid test isolation issues:
```typescript
const db = new PGlite(); // no opfs:// prefix = in-memory
```

---

### 2.4 Service Worker / MCP Tests (Vitest + MSW or SW test harness)

**Scope**: MCP tool request/response format; REST endpoint correctness

**Location**: `tests/mcp/`

**Key suites**:

| Suite | Description |
|---|---|
| `mcp.tools.test.ts` | All 38 MCP tool request/response shapes |
| `service.worker.lifecycle.test.ts` | SW registration, activation, update drain |
| `rest.api.test.ts` | REST endpoint coverage (`/api/v1/notes`, `/api/v1/search`) |

---

### 2.5 E2E Tests (Playwright)

**Scope**: Full user flows in real browsers; offline mode; capability module UX; browser compatibility matrix

**Location**: `tests/e2e/`

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

---

## 3. CI Pipeline (Gitea Actions)

```yaml
# .gitea/workflows/ci.yml

name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-and-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit         # vitest run
      - run: npm run test:format-parity # vitest run tests/format-parity/
      - run: npm run test:integration   # vitest run tests/integration/
      - run: npm run test:coverage      # vitest run --coverage

  e2e-chromium:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npm run build
      - run: npm run test:e2e -- --project=chromium

  e2e-firefox:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install firefox --with-deps
      - run: npm run build
      - run: npm run test:e2e -- --project=firefox

  build:
    runs-on: ubuntu-latest
    needs: [unit-and-integration]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run build
      - run: npm run bundle:analyze    # fail if > 500KB gzip
```

**Required checks to pass before merge**:
1. `unit-and-integration` (includes format parity)
2. `e2e-chromium`
3. `build` (bundle size gate)

---

## 4. Test Data and Fixtures

### Server Fixtures

Server fixture files are exported from the fortemi server and committed to `tests/fixtures/server/`. They represent canonical JSON shapes that browser output must match.

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
// tests/helpers/seed.ts
export async function seedNotes(db: PGlite, count: number) {
  // Batch insert using COPY protocol for speed
}
```

---

## 5. Coverage Targets

| Layer | Target | Tool |
|---|---|---|
| Repository layer | 80% | `@vitest/coverage-v8` |
| Format parity | 100% (all 21 tables) | Vitest |
| Worker communication | 70% | Vitest |
| MCP tools | 90% (all 38 tools) | Vitest |
| E2E critical paths | Manual checklist | Playwright |

**Coverage command**:
```bash
vitest run --coverage --reporter=text --reporter=lcov
```

**Coverage threshold** (vitest.config.ts):
```typescript
coverage: {
  thresholds: {
    lines: 60,
    functions: 60,
    branches: 60,
    statements: 60,
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
