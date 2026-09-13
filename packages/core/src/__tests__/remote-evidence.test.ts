import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { parseRemoteSearch } from '../remote-contract.js'
import { bindSearchEvidence, resolveSearchEvidence, type EvidenceTextSnapshot } from '../search-evidence.js'
import { createSearchEvidenceSet } from '../search-evidence-set.js'

const captured = JSON.parse(readFileSync(new URL('./fixtures/remote-operations.json', import.meta.url), 'utf8'))
const original = captured.cases.search_nonempty.response.body
const detail = captured.cases.detail_second.response.body
const id: string = original.results[0].note_id
const source = { namespace: 'fixture', external_id_hash: 'sha256:' + 'a'.repeat(64), import_run_id: 'run-1', schema_version: '1' }
const text = '\ufeffneedle\r\n\ud83d\ude00 e\u0301'
const snapshots: EvidenceTextSnapshot[] = [
  { note_id: id, unit: { kind: 'embedding', id: 'embedding-7', index: 7 }, content: text, source },
  { note_id: id, unit: { kind: 'title', id, index: 0 }, content: text },
  { note_id: id, unit: { kind: 'current', id, index: 0 }, content: text, source },
  { note_id: id, unit: { kind: 'attachment', id: 'attachment-1', index: 0 }, content: text, source },
]
const evidence = createSearchEvidenceSet(id, snapshots.map(s => bindSearchEvidence(s, 0, new TextEncoder().encode(s.content).length)))
function envelope(value: unknown = evidence) {
  return { ...structuredClone(original), results: [{ ...structuredClone(original.results[0]), evidence: value }], total: 1 }
}
function backend(value: unknown, detailValue = detail) {
  const fetchImpl = vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url)).pathname
    if (path === '/api/v1/search') return Response.json(value)
    expect(path).toBe('/api/v1/notes/' + id)
    return Response.json(detailValue)
  })
  return { fetchImpl, remote: createRemoteBackend({ baseUrl: 'https://synthetic-evidence.invalid', fetchImpl }) }
}

describe('candidate remote evidence (synthetic envelope, not live producer acceptance)', () => {
  it('validates and retains exact immutable native units and source tuples', () => {
    const input = envelope(structuredClone(evidence))
    const parsed = parseRemoteSearch(input, 'NEEDLE', 10).results[0]
    expect(parsed).toHaveProperty('evidence', evidence)
    const retained = (parsed as { evidence: typeof evidence }).evidence
    for (const [index, locator] of retained.locators.entries()) {
      expect(resolveSearchEvidence(locator, snapshots[index])).toBe(text)
      expect(Object.isFrozen(locator.unit)).toBe(true)
      expect(Object.isFrozen(locator.span)).toBe(true)
      if (locator.source) expect(Object.isFrozen(locator.source)).toBe(true)
    }
    expect(Object.isFrozen(retained)).toBe(true)
    expect(Object.isFrozen(retained.locators)).toBe(true)
    const inputSet = input.results[0].evidence as { locators: { unit: { index: number } }[] }
    inputSet.locators[0].unit.index = 99
    expect(retained.locators[0].unit.index).toBe(7)
  })

  it.each(['fts', 'semantic', 'hybrid'] as const)('forwards %s evidence without detail-text rebinding', async mode => {
    const changed = structuredClone(detail)
    changed.revised.content = 'replacement text must not replace ranked evidence'
    const { remote, fetchImpl } = backend(envelope(), changed)
    const result = await remote.search('NEEDLE', { mode, limit: 10 })
    expect(result.hits[0].evidence).toEqual(evidence)
    expect(result.hits[0].remoteSearch).not.toHaveProperty('evidence')
    expect(result.hits[0]).not.toHaveProperty('locators')
    expect(result.hits[0].note.id).toBe(id)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(remote.capabilities.evidenceLocators).toBe(false)
    const locator = result.hits[0].evidence!.locators[0]
    expect(resolveSearchEvidence(locator, snapshots[0])).toBe(text)
    expect(() => resolveSearchEvidence(locator, { ...snapshots[0], content: changed.revised.content })).toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })

  it('retains evidence in both semantic entry points and explicit degraded reports', async () => {
    const { remote } = backend(envelope())
    expect((await remote.semantic!('NEEDLE', 10))[0].evidence).toEqual(evidence)
    expect((await remote.semanticWithReport('NEEDLE', 10)).hits[0].evidence).toEqual(evidence)
    const degraded = backend({ ...envelope(), degraded: true, degradation: { code: 'embedding_request_failed', effective_mode: 'fts' } })
    await expect(degraded.remote.semantic!('NEEDLE', 10)).rejects.toMatchObject({ kind: 'degraded-search' })
    expect(degraded.fetchImpl).toHaveBeenCalledTimes(1)
    expect((await degraded.remote.semanticWithReport('NEEDLE', 10)).hits[0].evidence).toEqual(evidence)
  })

  it('preserves absence for legacy producer responses', async () => {
    const { remote } = backend(original)
    expect(parseRemoteSearch(original, 'NEEDLE', 10).results[0]).not.toHaveProperty('evidence')
    for (const hit of (await remote.search('NEEDLE')).hits) expect(hit).not.toHaveProperty('evidence')
  })

  it('preserves empty unavailable and partial omission reports', async () => {
    for (const value of [createSearchEvidenceSet(id, []), createSearchEvidenceSet(id, evidence.locators, ['unavailable-unit', 'locator-limit'])]) {
      expect((await backend(envelope(value)).remote.search('NEEDLE')).hits[0].evidence).toEqual(value)
    }
  })

  it('preserves separate ranked snapshots for repeated hits without repeating detail I/O', async () => {
    const second = createSearchEvidenceSet(id, [bindSearchEvidence({ ...snapshots[0], content: 'second snapshot' }, 0, 15)])
    const response = { ...envelope(), total: 2, results: [envelope().results[0], envelope(second).results[0]] }
    const { remote, fetchImpl } = backend(response)
    expect((await remote.search('NEEDLE')).hits.map(hit => hit.evidence)).toEqual([evidence, second])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  const bad: [string, () => unknown][] = [
    ['null', () => null], ['wrong type', () => 'PRIVATE_RESPONSE'],
    ['future version', () => ({ ...evidence, version: '2.0.0' })],
    ['unknown field', () => ({ ...evidence, private_value: 'PRIVATE_RESPONSE' })],
    ['empty unexplained', () => ({ ...evidence, locators: [] })],
    ['duplicate', () => ({ ...evidence, locators: [evidence.locators[0], evidence.locators[0]] })],
    ['unordered', () => ({ ...evidence, locators: [...evidence.locators].reverse() })],
    ['foreign note', () => ({ ...evidence, locators: [{ ...evidence.locators[0], note_id: 'foreign-note' }] })],
    ['raw external key', () => ({ ...evidence, locators: [{ ...evidence.locators[0], source: { ...source, external_key: 'PRIVATE_RESPONSE' } }] })],
    ['bad span', () => ({ ...evidence, locators: [{ ...evidence.locators[0], span: { unit: 'utf8-bytes', start: 2, end: 1 } }] })],
    ['bad index', () => ({ ...evidence, locators: [{ ...evidence.locators[0], unit: { ...evidence.locators[0].unit, index: -1 } }] })],
    ['bad digest', () => ({ ...evidence, locators: [{ ...evidence.locators[0], content_digest: 'PRIVATE_RESPONSE' }] })],
    ['over limit', () => ({ ...evidence, locators: Array.from({ length: 65 }, () => evidence.locators[0]) })],
    ['unknown omission', () => ({ ...evidence, omissions: ['PRIVATE_RESPONSE'] })],
  ]
  it.each(bad)('rejects %s evidence before any enrichment, with bounded errors', async (_name, value) => {
    const { remote, fetchImpl } = backend(envelope(value()))
    await expect(remote.search('NEEDLE')).rejects.toMatchObject({ name: 'RemoteBackendError', kind: 'invalid-response', message: 'Remote backend invalid-response.' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    try { parseRemoteSearch(envelope(value()), 'NEEDLE', 10) } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_RESPONSE')
      expect(error).not.toHaveProperty('cause')
    }
  })

  it('validates every hit before fetching even the first detail', async () => {
    const response = { ...envelope(), total: 2, results: [envelope().results[0], envelope(null).results[0]] }
    const { remote, fetchImpl } = backend(response)
    await expect(remote.search('NEEDLE')).rejects.toMatchObject({ kind: 'invalid-response' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
