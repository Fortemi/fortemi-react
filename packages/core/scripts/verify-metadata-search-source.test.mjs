import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AUTHORITY_PATH, MAX_BYTES, SOURCE_FILES, createUpstreamReader, verifyMetadataSearchSource } from './verify-metadata-search-source.mjs'

const directory = new URL('../schemas/metadata-search/candidate/1.0.0/', import.meta.url)
const original = JSON.parse(readFileSync(new URL('source.receipt.json', directory)))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'metadata-source-pin-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const name of [...SOURCE_FILES, ...Object.keys(original.historicalReceipts)]) {
    copyFileSync(new URL(name, directory), join(root, name))
  }
  const pin = structuredClone(original)
  const upstream = new Map(SOURCE_FILES.map(name => [AUTHORITY_PATH + name, readFileSync(join(root, name))]))
  for (const item of [pin.authority.openapi, pin.authority.documentation]) {
    const bytes = Buffer.from(`synthetic test authority: ${item.path}`)
    item.sha256 = digest(bytes)
    upstream.set(item.path, bytes)
  }
  const calls = []
  const options = { consumerDirectory: root, pin, readUpstream: async (commit, path) => {
    calls.push({ commit, path })
    return upstream.get(path)
  } }
  return { root, pin, upstream, calls, options }
}

test('binds every schema/vector, current OpenAPI and authority documentation while preserving historical receipts', async t => {
  const f = fixture(t)
  const result = await verifyMetadataSearchSource(f.options)
  assert.deepEqual(result, { status: 'PASS', commit: original.authority.commit, candidateFiles: 11,
    upstreamFiles: 13, historicalReceiptsUnchanged: 3, publishedRuntimeAcceptance: false, suiteParity: false })
  assert.equal(f.calls.length, 13)
  assert.ok(f.calls.every(c => c.commit === original.authority.commit))
})

for (const [name, change] of [
  ['schema version', p => { p.schemaVersion = 'unknown' }],
  ['release promotion', p => { p.status = 'released' }],
  ['foreign authority', p => { p.authority.repository = 'other/repo' }],
  ['mutable revision', p => { p.authority.commit = 'main' }],
  ['authority path traversal', p => { p.authority.path = '../' }],
  ['missing candidate file', p => { delete p.authority.files['predicate-vectors.json'] }],
  ['extra candidate file', p => { p.authority.files['../foreign.json'] = '0'.repeat(64) }],
  ['missing historical receipt', p => { delete p.historicalReceipts['rest.receipt.json'] }],
  ['capability promotion', p => { p.claims.contractPromoted = true }],
  ['published runtime claim', p => { p.claims.publishedRuntimeAcceptance = true }],
  ['foreign consumer', p => { p.consumer.repository = 'other/repo' }],
  ['invalid digest', p => { p.historicalReceipts['contract.receipt.json'] = 'invalid' }],
  ['OpenAPI path substitution', p => { p.authority.openapi.path = 'other.yaml' }],
  ['documentation path substitution', p => { p.authority.documentation.path = 'other.md' }],
]) test(`rejects ${name} before upstream reads`, async t => {
  const f = fixture(t)
  change(f.pin)
  await assert.rejects(verifyMetadataSearchSource(f.options))
  assert.equal(f.calls.length, 0)
})

for (const name of ['contract.receipt.json', 'rest.receipt.json', 'resolution.receipt.json', 'predicates.schema.json']) {
  test(`rejects consumer drift in ${name}`, async t => {
    const f = fixture(t)
    writeFileSync(join(f.root, name), '{}\n')
    await assert.rejects(verifyMetadataSearchSource(f.options), /bytes differ/)
    assert.equal(f.calls.length, 0)
  })
}

for (const path of [AUTHORITY_PATH + 'search-rest-vectors.json', 'contracts/openapi/openapi.yaml', AUTHORITY_PATH + 'README.md']) {
  test(`rejects upstream drift in ${path}`, async t => {
    const f = fixture(t)
    f.upstream.set(path, Buffer.from('changed'))
    await assert.rejects(verifyMetadataSearchSource(f.options), /bytes differ/)
  })
}

test('fetch pins canonical origin and immutable revision, forbids redirects and supplies a deadline', async () => {
  const reader = createUpstreamReader(undefined, async (url, options) => {
    assert.equal(url, `https://git.integrolabs.net/Fortemi/fortemi/raw/commit/${original.authority.commit}/${AUTHORITY_PATH}predicates.schema.json`)
    assert.equal(options.redirect, 'error')
    assert.equal(typeof options.signal.addEventListener, 'function')
    return new Response('source')
  })
  assert.equal((await reader(original.authority.commit, AUTHORITY_PATH + 'predicates.schema.json')).toString(), 'source')
})

test('fetch rejects non-success and missing bodies', async () => {
  for (const response of [new Response('', { status: 404 }), new Response(null)]) {
    const reader = createUpstreamReader(undefined, async () => response)
    await assert.rejects(reader(original.authority.commit, AUTHORITY_PATH + 'predicates.schema.json'))
  }
})

test('fetch rejects streamed overflow', async () => {
  const reader = createUpstreamReader(undefined, async () => new Response(Buffer.alloc(MAX_BYTES + 1)))
  await assert.rejects(reader(original.authority.commit, AUTHORITY_PATH + 'predicates.schema.json'), /byte ceiling/)
})

test('fetch rejects unknown paths and mutable revisions before dispatch', async () => {
  let calls = 0
  const reader = createUpstreamReader(undefined, async () => { calls++; return new Response('unused') })
  await assert.rejects(reader('main', AUTHORITY_PATH + 'predicates.schema.json'))
  await assert.rejects(reader(original.authority.commit, '../private'))
  assert.equal(calls, 0)
})

test('transport errors propagate without a fallback to vendored bytes', async t => {
  const f = fixture(t)
  f.options.readUpstream = async () => { throw new Error('offline') }
  await assert.rejects(verifyMetadataSearchSource(f.options), /offline/)
})
