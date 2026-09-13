import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const candidatePath = 'schemas/metadata-search/candidate/1.0.0'
const authorityRoot = fileURLToPath(new URL('../../packages/core/', import.meta.url))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function verifyRemoteEvidenceResolution(core) {
  const id = '00000000-0000-4000-8000-000000000001'
  const text = '\ufeffneedle\r\n\u{1f680}'
  let payload = { text }, status = 200, calls = 0
  const requests = []
  const remote = core.createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid',
    headers: { 'X-Fortemi-Memory': 'fixture-memory' }, authToken: 'synthetic-token',
    fetchImpl: async (url, init) => {
      calls++
      assert.equal(new URL(String(url)).pathname, '/api/v1/search/evidence/resolve')
      assert.equal(init.method, 'POST')
      assert.equal(init.cache, 'no-store')
      assert.equal(init.redirect, 'error')
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-token')
      assert.equal(new Headers(init.headers).get('x-fortemi-memory'), 'fixture-memory')
      requests.push(JSON.parse(init.body))
      return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } })
    },
  })
  assert.equal(typeof remote.resolveEvidence, 'function', 'missing remote resolution operation')
  const checks = []
  let locator
  for (const kind of ['current', 'title', 'embedding', 'attachment']) {
    locator = core.bindSearchEvidence({ note_id: id, unit: { kind, id, index: kind === 'embedding' ? 7 : 0 }, content: text }, 0, Buffer.byteLength(text))
    assert.equal(await remote.resolveEvidence(locator), text)
    assert.deepEqual(requests.at(-1), { locator })
    checks.push(kind + '-resolution')
  }
  for (const options of [{ tenant_id: 'foreign' }, { archive_id: 'foreign' }, { visibility: 'private' }, { includeArchived: null }]) {
    const before = calls
    await assert.rejects(remote.resolveEvidence(locator, options), error => error.kind === 'invalid-request')
    assert.equal(calls, before)
  }
  checks.push('scope-rejected-before-io')
  await remote.resolveEvidence(locator, { metadataPredicates: [{ path: 'provider', op: 'eq', value: 'fixture' }], includeArchived: true })
  assert.deepEqual(requests.at(-1).metadata_predicates, [{ path: 'provider', op: 'eq', value: 'fixture' }])
  assert.equal(requests.at(-1).include_archived, true)
  checks.push('typed-scope-wire')
  for (const malformed of [{ text, unexpected: 'PRIVATE' }, { text: 'wrong' }, { text: null }]) {
    payload = malformed
    await assert.rejects(remote.resolveEvidence(locator), error => error.kind === 'invalid-response' && !error.cause)
  }
  checks.push('strict-response-span')
  status = 404
  await assert.rejects(remote.resolveEvidence(locator), error => error.kind === 'http' && error.status === 404)
  checks.push('unavailable-http-status')
  assert.equal(remote.capabilities.evidenceLocators, false)
  checks.push('complete-capability-false')
  return checks
}

export async function verifyRemoteSearchRest(core, responses) {
  const id = '00000000-0000-4000-8000-000000000001'
  const chain = { chain_id: id, original_title: 'display', chunks_matched: 1, best_chunk_sequence: 0, total_chunks: 1 }
  const hit = { note_id: id, score: 1, snippet: null, chain_info: chain }
  const base = { query: 'x', results: [hit], total: 1, degraded: false }
  const malformed = [
    { ...base, unexpected: 'PRIVATE_REST' },
    { ...base, results: [{ ...hit, unexpected: 'PRIVATE_REST' }] },
    { ...base, results: [{ ...hit, chain_info: { ...chain, unexpected: 'PRIVATE_REST' } }] },
    { ...base, results: [{ ...hit, chain_info: { ...chain, chain_id: '00000000-0000-4000-8000-000000000002' } }] },
    { ...base, results: [{ ...hit, chain_info: { ...chain, best_chunk_sequence: 4294967296 } }] },
    { ...base, results: [{ ...hit, chain_info: { ...chain, total_chunks: 4294967296 } }] },
    { ...base, degraded: true, degradation: { code: 'embedding_unavailable', effective_mode: 'semantic' } },
    { ...base, degraded: true, degradation: { code: 'embedding_unavailable', effective_mode: 'hybrid' } },
    { ...base, degraded: true, degradation: { code: 'embedding_unavailable', effective_mode: 'fts', unexpected: 'PRIVATE_REST' } },
  ]
  let payload = base, calls = 0
  const remote = core.createRemoteBackend({ baseUrl: 'https://synthetic-rest.invalid', fetchImpl: async url => {
    calls++
    const parsed = new URL(String(url))
    if (parsed.pathname === '/api/v1/search') return Response.json(payload)
    const noteId = parsed.pathname.split('/').at(-1)
    return Response.json({ note: { id: noteId, title: 'display', source: 'fixture', starred: false, archived: false,
      created_at_utc: '2026-09-12T00:00:00Z', updated_at_utc: '2026-09-12T00:00:00Z' },
    original: { content: 'display' }, revised: { content: 'display' }, tags: [] })
  } })
  const checks = []
  for (const [index, value] of malformed.entries()) {
    payload = value
    const before = calls
    await assert.rejects(remote.search('x'), error => error.kind === 'invalid-response'
      && error.message === 'Remote backend invalid-response.' && error.cause === undefined)
    assert.equal(calls, before + 1)
    checks.push('malformed-before-enrichment-' + index)
  }
  assert.equal(responses.length, 8)
  for (const test of responses) {
    payload = test.value
    const before = calls
    const execute = () => remote.search(payload.query ?? 'x')
    if (test.valid) {
      const result = await execute()
      assert.equal(result.hits.length, payload.results.length)
      assert.equal(result.degraded, payload.degraded)
      if (payload.degradation) assert.equal(result.effectiveMode, 'fts')
    } else {
      await assert.rejects(execute(), error => error.kind === 'invalid-response')
      assert.equal(calls, before + 1)
    }
    checks.push(test.id)
  }
  assert.equal(remote.capabilities.evidenceLocators, false)
  for (const options of [{ limit: 0 }, { limit: 101 }, { diversity: 0.5 }, { metadata_predicates: [] }]) {
    const before = calls
    await assert.rejects(remote.search('x', options), error => error.kind === 'invalid-request')
    assert.equal(calls, before)
  }
  checks.push('unsupported-request-subset-before-io')
  return checks
}

export async function verifyRemoteSearchEvidence(core) {
  const id = '00000000-0000-4000-8000-000000000001'
  const raw = '\ufeffneedle\r\n\u{1f680}'
  const snapshots = ['embedding', 'title', 'current', 'attachment'].map(kind => ({
    note_id: id, unit: { kind, id: kind === 'current' || kind === 'title' ? id : kind + '-id', index: kind === 'embedding' ? 7 : 0 },
    content: raw, source: { namespace: 'fixture', external_id_hash: 'sha256:' + 'a'.repeat(64), import_run_id: 'run', schema_version: '1' },
  }))
  const evidence = core.createSearchEvidenceSet(id, snapshots.map(snapshot => core.bindSearchEvidence(snapshot, 0, Buffer.byteLength(raw))))
  const hit = { note_id: id, score: 1, snippet: 'display only', evidence }
  const envelope = { query: 'needle', total: 1, results: [hit], degraded: false }
  const detail = { note: { id, title: 'changed title', source: 'fixture', starred: false, archived: false,
    created_at_utc: '2026-09-12T00:00:00Z', updated_at_utc: '2026-09-12T00:00:00Z' },
  original: { content: 'original display' }, revised: { content: 'replacement display' }, tags: [] }
  let payload = envelope
  let calls = 0
  const remote = core.createRemoteBackend({ baseUrl: 'https://synthetic-evidence.invalid', fetchImpl: async url => {
    calls++
    const path = new URL(String(url)).pathname
    if (path === '/api/v1/search') return Response.json(payload)
    assert.equal(path, '/api/v1/notes/' + id)
    return Response.json(detail)
  } })
  assert.equal(remote.capabilities.evidenceLocators, false)
  const checks = []
  for (const mode of ['fts', 'semantic', 'hybrid']) {
    const result = (await remote.search('needle', { mode })).hits[0]
    assert.deepEqual(result.evidence, evidence)
    assert.equal(Object.isFrozen(result.evidence), true)
    for (const [index, locator] of result.evidence.locators.entries()) {
      assert.equal(core.resolveSearchEvidence(locator, snapshots[index]), raw)
      assert.throws(() => core.resolveSearchEvidence(locator, { ...snapshots[index], content: detail.revised.content }), /SEARCH_EVIDENCE_UNAVAILABLE/)
    }
    checks.push(mode + '-remote-evidence-no-rebinding')
  }
  assert.deepEqual((await remote.semantic('needle', 10))[0].evidence, evidence)
  assert.deepEqual((await remote.semanticWithReport('needle', 10)).hits[0].evidence, evidence)
  checks.push('both-semantic-entry-points')
  payload = { ...envelope, results: [{ note_id: id, score: 1, snippet: null }] }
  assert.equal(Object.hasOwn((await remote.search('needle')).hits[0], 'evidence'), false)
  checks.push('legacy-absence')
  payload = { ...envelope, results: [{ ...hit, evidence: core.createSearchEvidenceSet(id, []) }] }
  assert.deepEqual((await remote.search('needle')).hits[0].evidence.omissions, ['unavailable-unit'])
  checks.push('unavailable-omission')
  for (const bad of [null, { ...evidence, version: '2.0.0' }, { ...evidence, locators: [{ ...evidence.locators[0], note_id: 'foreign' }] },
    { ...evidence, locators: [{ ...evidence.locators[0], source: { ...snapshots[0].source, external_key: 'PRIVATE' } }] }]) {
    payload = { ...envelope, total: 2, results: [hit, { ...hit, evidence: bad }] }
    const before = calls
    await assert.rejects(remote.search('needle'), error => error.kind === 'invalid-response' && error.message === 'Remote backend invalid-response.' && error.cause === undefined)
    assert.equal(calls, before + 1)
  }
  checks.push('all-hits-validated-before-enrichment')
  return checks
}

// The child supplies its installed public API; this module never imports Core source.
export async function verifySearchEvidenceCorpus(core, packageRoot) {
  const read = (root, path) => readFileSync(resolve(root, candidatePath, path))
  const receipt = JSON.parse(read(authorityRoot, 'contract.receipt.json'))
  assert.equal(receipt.status, 'candidate-unpublished')
  assert.equal(receipt.claims.promotedContract, false)
  const files = []
  for (const path of ['contract.receipt.json', ...Object.keys(receipt.authority.files)]) {
    const authority = read(authorityRoot, path)
    const installed = read(packageRoot, path)
    assert.equal(digest(installed), digest(authority), 'installed candidate differs: ' + path)
    if (path !== 'contract.receipt.json') {
      assert.equal(digest(installed), receipt.authority.files[path], 'candidate receipt mismatch: ' + path)
    }
    files.push({ path, sha256: digest(installed), bytes: installed.length })
  }
  const restReceipt = JSON.parse(read(authorityRoot, 'rest.receipt.json'))
  assert.equal(restReceipt.status, 'candidate-unpublished')
  assert.equal(restReceipt.claims.promotedContract, false)
  assert.equal(restReceipt.claims.liveProducerAcceptance, false)
  const restFiles = []
  for (const path of ['rest.receipt.json', ...Object.keys(restReceipt.authority.files)]) {
    const installed = read(packageRoot, path)
    assert.equal(digest(installed), digest(read(authorityRoot, path)), 'installed REST candidate differs: ' + path)
    if (path !== 'rest.receipt.json') assert.equal(digest(installed), restReceipt.authority.files[path], 'REST receipt mismatch: ' + path)
    restFiles.push({ path, sha256: digest(installed), bytes: installed.length })
  }
  const binding = JSON.parse(read(packageRoot, 'evidence-vectors.json')).cases
  const resolutionReceipt = JSON.parse(read(authorityRoot, 'resolution.receipt.json'))
  assert.equal(resolutionReceipt.status, 'candidate-unpublished')
  assert.equal(resolutionReceipt.claims.promotedContract, false)
  assert.equal(resolutionReceipt.claims.liveProducerAcceptance, false)
  const resolutionFiles = []
  for (const path of ['resolution.receipt.json', ...Object.keys(resolutionReceipt.authority.files)]) {
    const installed = read(packageRoot, path)
    assert.equal(digest(installed), digest(read(authorityRoot, path)), 'installed resolution candidate differs: ' + path)
    if (path !== 'resolution.receipt.json') assert.equal(digest(installed), resolutionReceipt.authority.files[path], 'resolution receipt mismatch: ' + path)
    resolutionFiles.push({ path, sha256: digest(installed), bytes: installed.length })
  }
  const envelopes = JSON.parse(read(packageRoot, 'evidence-set-vectors.json')).cases
  assert.equal(binding.length, 55)
  assert.equal(envelopes.length, 36)
  for (const test of binding) {
    if (test.error) {
      assert.throws(() => core.resolveSearchEvidence(test.locator, test.snapshot),
        error => error.message === test.error, test.id)
    } else {
      assert.equal(core.resolveSearchEvidence(test.locator, test.snapshot), test.text, test.id)
      assert.deepEqual(core.bindSearchEvidence(test.snapshot, test.locator.span.start,
        test.locator.span.end), test.locator, test.id)
    }
  }
  for (const test of envelopes) {
    const execute = () => {
      if (test.operation === 'parse') return core.parseSearchEvidenceSet(test.input, test.note_id)
      if (test.operation === 'build') return core.createSearchEvidenceSet(test.note_id, test.input, test.omissions)
      if (test.operation === 'merge') return core.mergeSearchEvidenceSets(test.note_id,
        test.input.map(value => core.parseSearchEvidenceSet(value, test.note_id)))
      throw new Error('Unknown corpus operation')
    }
    if (test.error) assert.throws(execute, error => error.message === test.error, test.id)
    else assert.deepEqual(execute(), test.expected, test.id)
  }

  const storageChecks = []
  const db = await core.createPGliteInstance('memory', 'installed-search-evidence')
  try {
    await new core.MigrationRunner(db).apply(core.allMigrations)
    const noteId = '\ufeffinstalled-note'
    const raw = '\ufeffneedle \u{1f680} cafe\u0301\r\n<raw>'
    const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)
    await db.query('INSERT INTO note (id, title) VALUES ($1, $2)', [noteId, raw])
    await db.query('INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)', [noteId, raw])
    await db.exec("INSERT INTO embedding_set (id, model_name, dimensions) VALUES ('set', 'synthetic', 384)")
    await db.query(`INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text, vector)
      VALUES ('winner', $1, 'set', 7, $2, $3::vector)`, [noteId, raw, JSON.stringify(vector)])
    await db.exec("INSERT INTO attachment_blob (id, content_hash, size_bytes) VALUES ('blob', 'fixture', 1)")
    await db.query(`INSERT INTO attachment (id, note_id, blob_id, filename, mime_type, extracted_text, status)
      VALUES ('attachment', $1, 'blob', 'private.txt', 'text/plain', $2, 'completed')`, [noteId, raw])
    const search = new core.SearchRepository(db, true)
    const backend = core.createPGliteBackend(db, { semanticAvailable: true, embedQuery: async () => vector })
    assert.equal(backend.capabilities.evidenceLocators, false)
    const expectedKinds = { text: ['title', 'current', 'attachment'], semantic: ['embedding'],
      hybrid: ['embedding', 'title', 'current', 'attachment'] }
    let stale
    for (const mode of ['text', 'semantic', 'hybrid']) {
      const hit = (await search.search('needle', { mode }, vector)).results[0]
      assert.equal(hit.id, noteId)
      const evidence = core.parseSearchEvidenceSet(hit.evidence, noteId)
      assert.deepEqual(evidence.omissions, [])
      assert.deepEqual(evidence.locators.map(locator => locator.unit.kind), expectedKinds[mode])
      for (const locator of evidence.locators) {
        assert.deepEqual(locator.span, { unit: 'utf8-bytes', start: 0, end: Buffer.byteLength(raw) })
        assert.equal(await search.resolveEvidence(locator), raw)
        if (locator.unit.kind === 'embedding') assert.deepEqual(locator.unit,
          { kind: 'embedding', id: 'winner', index: 7 })
      }
      storageChecks.push(mode + '-exact-unit-resolution')
      const adapted = (await backend.search('needle', { mode: mode === 'text' ? 'fts' : mode })).hits[0]
      assert.equal(adapted.note.id, noteId)
      assert.deepEqual(adapted.evidence, evidence)
      storageChecks.push(mode + '-adapter-forwarding')
      stale ??= evidence.locators.find(locator => locator.unit.kind === 'current')
    }
    await db.query('UPDATE note_revised_current SET content = $1 WHERE note_id = $2', ['replacement needle', noteId])
    await assert.rejects(search.resolveEvidence(stale), /SEARCH_EVIDENCE_UNAVAILABLE/)
    storageChecks.push('changed-text-rejected')
    await db.query('UPDATE note SET deleted_at = now() WHERE id = $1', [noteId])
    assert.deepEqual((await search.search('needle', { mode: 'hybrid' }, vector)).results, [])
    await assert.rejects(search.resolveEvidence(stale), /SEARCH_EVIDENCE_UNAVAILABLE/)
    storageChecks.push('deleted-note-unavailable')
  } finally {
    await db.close()
  }
  const remoteChecks = await verifyRemoteSearchEvidence(core)
  const restChecks = await verifyRemoteSearchRest(core, JSON.parse(read(packageRoot, 'search-rest-vectors.json')).responses)
  const resolutionChecks = await verifyRemoteEvidenceResolution(core)
  return { status: 'PASS', bindingCases: binding.length, envelopeCases: envelopes.length,
    storageChecks, remoteChecks, restChecks, restFiles, resolutionChecks, resolutionFiles, files, scope: 'Clean-installed local candidate; synthetic vectors and remote responses, not live producer, inference or hosted authorization acceptance' }
}

export function verifyInstalledSearchEvidence(installRoot, expectedVersion) {
  const packageRoot = realpathSync(resolve(installRoot, 'node_modules/@fortemi/core'))
  const probe = `
    import assert from 'node:assert/strict';
    import * as core from '@fortemi/core';
    import { readFileSync, realpathSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    import { fileURLToPath } from 'node:url';
    import { verifySearchEvidenceCorpus } from ${JSON.stringify(import.meta.url)};
    const root = ${JSON.stringify(packageRoot)};
    const entry = fileURLToPath(import.meta.resolve('@fortemi/core'));
    assert.equal(realpathSync(entry), root + '/dist/index.js');
    const manifest = JSON.parse(readFileSync(root + '/package.json', 'utf8'));
    assert.equal(manifest.version, ${JSON.stringify(expectedVersion)});
    assert.equal(core.VERSION, manifest.version);
    const result = await verifySearchEvidenceCorpus(core, root);
    result.publicEntrySha256 = createHash('sha256').update(readFileSync(entry)).digest('hex');
    result.packageVersion = manifest.version;
    console.log(JSON.stringify(result));
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: installRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 256 * 1024,
  })
  assert.equal(result.status, 0,
    'installed search evidence probe failed: ' + (result.error?.code ?? result.stderr).slice(0, 4000))
  return JSON.parse(result.stdout.trim().split('\n').at(-1))
}
