import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { verifyRemoteEvidenceResolution, verifyRemoteSearchEvidence, verifyRemoteSearchRest, verifySearchEvidenceCorpus } from './verify-installed-search-evidence.mjs'

test('remote package gate detects a consumer that drops evidence', async () => {
  const core = { bindSearchEvidence: value => value, createSearchEvidenceSet: (_id, locators) => ({ locators }),
    createRemoteBackend: () => ({ capabilities: { evidenceLocators: false }, search: async () => ({ hits: [{}] }) }) }
  await assert.rejects(verifyRemoteSearchEvidence(core), /Expected values to be strictly deep-equal/)
})

test('REST package gate detects a permissive consumer', async () => {
  const core = { createRemoteBackend: () => ({ search: async () => ({ hits: [] }) }) }
  await assert.rejects(verifyRemoteSearchRest(core, []), /Missing expected rejection/)
})

const candidate = 'schemas/metadata-search/candidate/1.0.0'
test('resolution package gate detects a missing consumer operation', async () => {
  const core = { createRemoteBackend: () => ({}) }
  await assert.rejects(verifyRemoteEvidenceResolution(core), /missing remote resolution operation/)
})
const authority = fileURLToPath(new URL('../../packages/core/' + candidate, import.meta.url))
for (const [name, mutate, message] of [
  ['missing packaged resolution schema', root => rmSync(resolve(root, candidate, 'evidence-resolution.schema.json')), /ENOENT/],
  ['altered packaged resolution vectors', root => {
    const path = resolve(root, candidate, 'evidence-resolution-vectors.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.requests.pop()
    writeFileSync(path, JSON.stringify(value))
  }, /installed resolution candidate differs/],
  ['altered packaged resolution receipt', root => {
    const path = resolve(root, candidate, 'resolution.receipt.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.claims.promotedContract = true
    writeFileSync(path, JSON.stringify(value))
  }, /installed resolution candidate differs/],
  ['missing packaged REST schema', root => rmSync(resolve(root, candidate, 'search-rest.schema.json')), /ENOENT/],
  ['altered packaged REST vectors', root => {
    const path = resolve(root, candidate, 'search-rest-vectors.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.responses.pop()
    writeFileSync(path, JSON.stringify(value))
  }, /installed REST candidate differs/],
  ['altered packaged REST receipt', root => {
    const path = resolve(root, candidate, 'rest.receipt.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.claims.promotedContract = true
    writeFileSync(path, JSON.stringify(value))
  }, /installed REST candidate differs/],
  ['missing packaged schema', root => rmSync(resolve(root, candidate, 'evidence-set.schema.json')), /ENOENT/],
  ['altered packaged corpus', root => {
    const path = resolve(root, candidate, 'evidence-set-vectors.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.cases.pop()
    writeFileSync(path, JSON.stringify(value))
  }, /installed candidate differs/],
  ['altered packaged receipt', root => {
    const path = resolve(root, candidate, 'contract.receipt.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.claims.promotedContract = true
    writeFileSync(path, JSON.stringify(value))
  }, /installed candidate differs/],
]) {
  test(name + ' fails before installed API execution', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'fortemi-evidence-negative-'))
    let accessed = false
    const core = new Proxy({}, { get() { accessed = true; throw new Error('Unexpected API access') } })
    try {
      cpSync(authority, resolve(root, candidate), { recursive: true })
      mutate(root)
      await assert.rejects(verifySearchEvidenceCorpus(core, root), message)
      assert.equal(accessed, false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
