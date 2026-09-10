import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { parseRemoteSearch } from '../remote-contract.js'

const bytes = readFileSync(new URL('./fixtures/remote-operations.json', import.meta.url))
const fixture = JSON.parse(bytes.toString('utf8'))
const body = (name: string) => fixture.cases[name].response.body
const id = body('create_second').id as string
function response(name: string) {
  const value = fixture.cases[name].response
  return new Response(value.status === 204 ? null : JSON.stringify(value.body), {
    status: value.status, headers: value.contentType ? { 'Content-Type': value.contentType } : {},
  })
}
function captured(name: string) {
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const target = new URL(String(url))
    const expected = fixture.cases[name].request
    if (target.pathname === '/api/v1/search' || init?.method !== 'GET') {
      expect(target.pathname + target.search).toBe(expected.path)
      expect(init?.method).toBe(expected.method)
      expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(expected.body)
      return response(name)
    }
    expect(target.pathname).toBe(`/api/v1/notes/${id}`)
    return response('detail_second')
  })
  return { fetchImpl, remote: createRemoteBackend({ baseUrl: 'https://producer-fixture.invalid', fetchImpl }) }
}

describe('producer-captured search and mutation contracts (#419/#420/#1146)', () => {
  it('pins the independent producer capture and cleanup boundary', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('c086a4ec2f02fb3e1c12b25c93427dbe720a4527b6eadef6cd3244b568397d52')
    expect(fixture.producer.commit).toBe('e91c595a896275f835cb7ed1aef173cb26056206')
    expect(fixture.cleanup.remainingVisibleNotes).toBe(0)
  })

  it.each(['search_nonempty', 'search_empty', 'search_tags', 'search_tags_no_match', 'search_limit', 'search_semantic_degraded', 'search_hybrid_degraded'])(
    'projects %s with producer query, filters and explicit degradation', async (name) => {
      const { remote, fetchImpl } = captured(name)
      const params = new URL(fixture.cases[name].request.path, 'https://fixture.invalid').searchParams
      const mode = params.get('mode') as 'fts' | 'semantic' | 'hybrid'
      const result = await remote.search(params.get('q')!, { mode, limit: Number(params.get('limit')),
        ...(params.has('tags') ? { tags: params.get('tags')!.split(',') } : {}) })
      expect(result).toMatchObject({ total: body(name).total, totalKind: 'returned-hits',
        requestedMode: mode, degraded: body(name).degraded,
        effectiveMode: body(name).degradation?.effective_mode ?? mode })
      expect(result.degradation).toEqual(body(name).degradation)
      expect(result.facets).toBeUndefined()
      expect(fetchImpl).toHaveBeenCalledTimes(1 + body(name).results.length)
      for (const [index, hit] of result.hits.entries()) {
        expect(hit).toMatchObject({ note: { id, createdAt: body('detail_second').note.created_at_utc,
          updatedAt: body('detail_second').note.updated_at_utc, tags: body(name).results[index].tags },
        rank: body(name).results[index].score, snippet: body(name).results[index].snippet,
        remoteSearch: { chain_info: body(name).results[index].chain_info } })
      }
    },
  )

  it('exposes semantic fallback only through the report-bearing method', async () => {
    const { remote, fetchImpl } = captured('search_semantic_degraded')
    await expect(remote.semantic!('NEEDLE', 10)).rejects.toMatchObject({ kind: 'degraded-search' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const result = await remote.semanticWithReport('NEEDLE', 10)
    expect(result).toMatchObject({ requestedMode: 'semantic', effectiveMode: 'fts', degraded: true,
      degradation: { code: 'embedding_request_failed', effective_mode: 'fts' } })
  })

  it.each([
    ['update_content', { action: 'update', note_id: id, content: 'REMOTE CONTRACT UPDATED' }],
    ['update_tags', { action: 'update', note_id: id, tags: ['lane-b-remote', 'updated'] }],
    ['star', { action: 'star', note_id: id }], ['unstar', { action: 'unstar', note_id: id }],
    ['archive', { action: 'archive', note_id: id }], ['unarchive', { action: 'unarchive', note_id: id }],
    ['delete', { action: 'delete', note_id: id }], ['restore', { action: 'restore', note_id: id }],
  ] as const)('maps %s to its actual method, body and response', async (name, input) => {
    const { remote, fetchImpl } = captured(name)
    const result = await remote.manageNote(input)
    expect(result).toMatchObject({ action: input.action, note_id: id })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    if (name === 'delete' || name === 'restore') expect(result.note).toBeUndefined()
    else expect(result.note).toMatchObject({ id, content: body(name).revised.content,
      starred: body(name).note.starred, archived: body(name).note.archived, tags: body(name).tags })
  })

  it('creates without enabling the inference pipeline or inventing a note response', async () => {
    const { remote } = captured('create_second')
    const request = fixture.cases.create_second.request.body
    const result = await remote.manageNote({ action: 'create', content: request.content, title: request.title,
      tags: request.tags, source: request.source })
    expect(result).toEqual({ action: 'create', note_id: id })
  })

  it('does not advertise shard merge capability', () => {
    expect(captured('search_empty').remote.capabilities).toMatchObject({ write: true, merge: false, semantic: 'server' })
  })

  it('canonicalizes uppercase UUID input before reads and mutations', async () => {
    const { remote } = captured('star')
    expect((await remote.getNote(id.toUpperCase()))?.id).toBe(id)
    expect((await remote.manageNote({ action: 'star', note_id: id.toUpperCase() })).note_id).toBe(id)
  })
})

describe('remote operation malformed-input and fault injection (not live qualification)', () => {
  it.each([{ offset: 1 }, { source: ['private'] }, { limit: 0 }, { limit: 101 }, { limit: 1.5 },
    { tags: ['one,two'] }, { tags: [''] }, { tags: [' padded '] }, { mode: 'vector' }])(
    'rejects unsupported/invalid search options %j before dispatch', async (options) => {
      const fetchImpl = vi.fn<typeof fetch>()
      const remote = createRemoteBackend({ baseUrl: 'https://fixture.invalid', fetchImpl })
      await expect(remote.search('NEEDLE', options as never)).rejects.toHaveProperty('name', 'RemoteBackendError')
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it.each([{ action: 'purge', note_id: id }, { action: 'update', note_id: id, title: 'unsupported' },
    { action: 'update', note_id: id }, { action: 'update', note_id: id, format: 'text' },
    { action: 'delete', note_id: 'invalid' }, { action: 'star', note_id: id, content: 'must not be ignored' },
    { action: 'create', content: 'x', revision_mode: 'full' }])(
    'rejects unsupported/invalid mutation %j before dispatch', async (input) => {
      const fetchImpl = vi.fn<typeof fetch>()
      const remote = createRemoteBackend({ baseUrl: 'https://fixture.invalid', fetchImpl })
      await expect(remote.manageNote(input)).rejects.toMatchObject({ kind: 'invalid-request' })
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it('rejects legacy tool/semantic path overrides rather than treating them as adapters', () => {
    for (const paths of [{ manageNote: '/custom' }, { semantic: '/custom' }]) {
      expect(() => createRemoteBackend({ baseUrl: 'https://fixture.invalid', paths })).toThrow('unsupported-operation')
    }
  })

  it('fails search when detail enrichment is absent instead of returning fabricated metadata', async () => {
    const remote = createRemoteBackend({ baseUrl: 'https://fixture.invalid', fetchImpl: async (url) =>
      new URL(String(url)).pathname.endsWith('/search') ? response('search_nonempty') : response('deleted_not_found') })
    await expect(remote.search('NEEDLE', { limit: 10 })).rejects.toMatchObject({ kind: 'http', status: 404 })
  })

  it('rejects malformed fields, mismatched query/count and missing degradation metadata', () => {
    const malformed = structuredClone(body('search_nonempty'))
    delete malformed.results[0].note_id
    expect(() => parseRemoteSearch(malformed, 'NEEDLE', 10)).toThrow('invalid-response')
    for (const changes of [{ query: 'other' }, { total: 99 }, { degraded: true }]) {
      expect(() => parseRemoteSearch({ ...body('search_nonempty'), ...changes }, 'NEEDLE', 10)).toThrow('invalid-response')
    }
    expect(() => parseRemoteSearch(body('search_nonempty'), 'NEEDLE', 0)).toThrow('invalid-response')
  })

  it('retains mutation failures and rejects malformed success rather than implying rollback', async () => {
    const remote = createRemoteBackend({ baseUrl: 'https://fixture.invalid', fetchImpl: async () => response('not_found') })
    await expect(remote.manageNote({ action: 'delete', note_id: id })).rejects.toMatchObject({ kind: 'http', status: 404 })
    const invalid = createRemoteBackend({ baseUrl: 'https://fixture.invalid', fetchImpl: async () => Response.json({}) })
    await expect(invalid.manageNote({ action: 'star', note_id: id })).rejects.toMatchObject({ kind: 'invalid-response' })
    await expect(invalid.manageNote({ action: 'delete', note_id: id })).rejects.toMatchObject({ kind: 'invalid-response', status: 200 })
  })
})
