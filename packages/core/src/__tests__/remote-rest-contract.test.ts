import { describe, expect, it, vi } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { parseRemoteSearch, remoteSearchParameters } from '../remote-contract.js'
import vectors from '../../schemas/metadata-search/candidate/1.0.0/search-rest-vectors.json' with { type: 'json' }
import { isSearchRestRequest, isSearchRestResponse } from '../remote-search-schema.js'

const id = '00000000-0000-0000-0000-000000000001'
const other = '00000000-0000-0000-0000-000000000002'
function envelope() {
  return { query: 'x', total: 1, degraded: false, results: [{ note_id: id, score: 0.5, snippet: null,
    chain_info: { chain_id: id, original_title: 'display', chunks_matched: 1, best_chunk_sequence: 0, total_chunks: 1 } }] }
}

describe('producer REST authority candidate', () => {
  it.each(vectors.requests)('shared decoded request schema $id', ({ valid, value }) => {
    expect(isSearchRestRequest(value)).toBe(valid)
  })
  it.each(vectors.responses)('shared response schema $id', ({ valid, value }) => {
    expect(isSearchRestResponse(value)).toBe(valid)
  })
  it.each(vectors.responses)('shared response $id', ({ valid, value }) => {
    const parse = () => parseRemoteSearch(value, 'query' in value ? value.query! : 'x', 1000)
    if (valid) expect(parse().total).toBe(value.total)
    else expect(parse).toThrow('Remote backend invalid-response.')
  })

  const invalid: [string, (value: ReturnType<typeof envelope>) => unknown][] = [
    ['unknown envelope field', v => ({ ...v, private_value: 'PRIVATE_REST' })],
    ['unknown hit field', v => ({ ...v, results: [{ ...v.results[0], private_value: 'PRIVATE_REST' }] })],
    ['unknown chain field', v => ({ ...v, results: [{ ...v.results[0], chain_info: { ...v.results[0].chain_info, private_value: 'PRIVATE_REST' } }] })],
    ['foreign chain identity', v => ({ ...v, results: [{ ...v.results[0], chain_info: { ...v.results[0].chain_info, chain_id: other } }] })],
    ['oversized chain index', v => ({ ...v, results: [{ ...v.results[0], chain_info: { ...v.results[0].chain_info, best_chunk_sequence: 4294967296 } }] })],
    ['oversized chain total', v => ({ ...v, results: [{ ...v.results[0], chain_info: { ...v.results[0].chain_info, total_chunks: 4294967296 } }] })],
    ['unknown degradation field', v => ({ ...v, degraded: true, degradation: { code: 'embedding_unavailable', effective_mode: 'fts', private_value: 'PRIVATE_REST' } })],
    ['semantic degradation', v => ({ ...v, degraded: true, degradation: { code: 'embedding_unavailable', effective_mode: 'semantic' } })],
    ['hybrid degradation', v => ({ ...v, degraded: true, degradation: { code: 'embedding_unavailable', effective_mode: 'hybrid' } })],
    ['over server limit', v => ({ ...v, total: 1001, results: Array.from({ length: 1001 }, () => v.results[0]) })],
  ]
  it.each(invalid)('rejects %s without retaining input', (_name, mutate) => {
    expect(() => parseRemoteSearch(mutate(envelope()), 'x', 2000)).toThrow('Remote backend invalid-response.')
    try { parseRemoteSearch(mutate(envelope()), 'x', 2000) } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_REST')
      expect(error).not.toHaveProperty('cause')
    }
  })

  it.each(invalid.slice(0, 9))('rejects %s before fetching any note detail', async (_name, mutate) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(mutate(envelope())))
    const remote = createRemoteBackend({ baseUrl: 'https://synthetic-rest.invalid', fetchImpl })
    await expect(remote.search('x')).rejects.toMatchObject({ kind: 'invalid-response' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retains the adapter request subset and limits, not every server option', () => {
    expect(remoteSearchParameters('x', {})).toEqual({ q: 'x', mode: 'fts', limit: 20 })
    expect(remoteSearchParameters('x', { mode: 'hybrid', limit: 100, tags: ['a', 'b'] })).toEqual({ q: 'x', mode: 'hybrid', limit: 100, tags: 'a,b' })
    for (const options of [{ limit: 0 }, { limit: 101 }, { mode: 'legacy-unknown' }, { metadata_predicates: [] }, { diversity: 0.5 }]) {
      expect(() => remoteSearchParameters('x', options)).toThrow('Remote backend invalid-request.')
    }
  })
})
