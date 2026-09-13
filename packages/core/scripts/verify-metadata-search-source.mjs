import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_BYTES = 1024 * 1024
export const AUTHORITY_PATH = 'contracts/metadata-search/candidate/1.0.0/'
export const SOURCE_FILES = [
  'predicates.schema.json', 'predicate-vectors.json', 'sql-scope-vectors.json',
  'evidence-locator.schema.json', 'evidence-vectors.json', 'evidence-set.schema.json',
  'evidence-set-vectors.json', 'search-rest.schema.json', 'search-rest-vectors.json',
  'evidence-resolution.schema.json', 'evidence-resolution-vectors.json',
]
const historicalNames = ['contract.receipt.json', 'rest.receipt.json', 'resolution.receipt.json']
const directory = new URL('../schemas/metadata-search/candidate/1.0.0/', import.meta.url)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const read = path => {
  assert.ok(statSync(path).size <= MAX_BYTES, 'consumer file exceeds byte ceiling')
  return readFileSync(path)
}

export function createUpstreamReader(authorityRoot, fetchImpl = globalThis.fetch) {
  return async (commit, path) => {
    assert.match(commit, /^[a-f0-9]{40}$/)
    assert.ok([...SOURCE_FILES.map(name => AUTHORITY_PATH + name),
      AUTHORITY_PATH + 'README.md', 'contracts/openapi/openapi.yaml'].includes(path), 'unknown authority path')
    if (authorityRoot) return execFileSync('git', ['-C', authorityRoot, 'show', `${commit}:${path}`], {
      timeout: 30000, maxBuffer: MAX_BYTES,
    })
    const response = await fetchImpl(`https://git.integrolabs.net/Fortemi/fortemi/raw/commit/${commit}/${path}`, {
      signal: globalThis.AbortSignal.timeout(30000), redirect: 'error',
    })
    assert.equal(response.status, 200, 'immutable producer fetch failed')
    assert.ok(response.body, 'missing producer body')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      assert.ok(size <= MAX_BYTES, 'producer file exceeds byte ceiling')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
}

export async function verifyMetadataSearchSource({ consumerDirectory = directory,
  readUpstream = createUpstreamReader(), pin } = {}) {
  const base = consumerDirectory instanceof URL ? consumerDirectory : pathToFileURL(resolve(consumerDirectory) + '/')
  const file = name => new URL(name, base)
  pin ??= JSON.parse(read(file('source.receipt.json')))
  assert.equal(pin.schemaVersion, 'fortemi.metadata-search-source-pin.v1')
  assert.equal(pin.status, 'merged-candidate-unreleased')
  const authority = pin.authority
  assert.equal(authority.repository, 'Fortemi/fortemi')
  assert.equal(authority.issue, 1091)
  assert.match(authority.commit, /^[a-f0-9]{40}$/)
  assert.equal(authority.path, AUTHORITY_PATH)
  assert.deepEqual(pin.consumer, { repository: 'Fortemi/fortemi-react', issue: 405 })
  assert.deepEqual(pin.claims, { contractPromoted: false, fullIssueAcceptance: false,
    publishedRuntimeAcceptance: false, suiteParity: false })
  assert.deepEqual(Object.keys(authority.files).sort(), [...SOURCE_FILES].sort())
  assert.deepEqual(Object.keys(pin.historicalReceipts).sort(), [...historicalNames].sort())
  const verifyDigest = (bytes, expected) => {
    assert.match(expected, /^[a-f0-9]{64}$/)
    assert.ok(bytes.length <= MAX_BYTES, 'producer file exceeds byte ceiling')
    assert.equal(digest(bytes), expected, 'source bytes differ from pin')
  }
  for (const name of historicalNames) {
    const bytes = read(file(name))
    verifyDigest(bytes, pin.historicalReceipts[name])
    const historical = JSON.parse(bytes)
    assert.equal(historical.status, 'candidate-unpublished')
    assert.equal(historical.claims.promotedContract, false)
    for (const [name, hash] of Object.entries(historical.authority.files)) {
      assert.equal(authority.files[name], hash, 'historical candidate file changed')
    }
  }
  for (const name of SOURCE_FILES) verifyDigest(read(file(name)), authority.files[name])
  assert.equal(authority.openapi.path, 'contracts/openapi/openapi.yaml')
  assert.equal(authority.documentation.path, AUTHORITY_PATH + 'README.md')
  const upstream = [...SOURCE_FILES.map(name => ({ path: AUTHORITY_PATH + name, sha256: authority.files[name] })),
    authority.openapi, authority.documentation]
  for (const item of upstream) verifyDigest(await readUpstream(authority.commit, item.path), item.sha256)
  return { status: 'PASS', commit: authority.commit, candidateFiles: SOURCE_FILES.length,
    upstreamFiles: upstream.length, historicalReceiptsUnchanged: historicalNames.length,
    publishedRuntimeAcceptance: false, suiteParity: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [option, root, ...extra] = process.argv.slice(2)
  assert.ok(!option || (option === '--authority-root' && root && extra.length === 0),
    'usage: verify-metadata-search-source.mjs [--authority-root <repo>]')
  console.log(JSON.stringify(await verifyMetadataSearchSource({ readUpstream: createUpstreamReader(root) })))
}
