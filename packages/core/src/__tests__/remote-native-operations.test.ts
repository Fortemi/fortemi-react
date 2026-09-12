import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { RemoteBackendError } from '../remote-error.js'

interface CapturedCall {
  check: string
  method: string
  path: string
  requestBody: Record<string, unknown> | null
  status: number
  contentType: string | null
  rawBody: string
  responseSha256: string
}

const directory = new URL('./fixtures/', import.meta.url)
const bytes = readFileSync(new URL('native-remote-operations.json', directory))
const fixture = JSON.parse(bytes.toString('utf8'))
const pin = JSON.parse(readFileSync(new URL('native-remote-operations.producer-pin.json', directory), 'utf8'))
const calls: CapturedCall[] = fixture.calls
const group = (check: string) => calls.filter((call) => call.check === check)
const body = (call: CapturedCall) => JSON.parse(call.rawBody)
const ids: string[] = fixture.syntheticCleanup.ids
const [first] = ids
const created = calls.filter((call) => call.status === 201)
const tag = (created[0].requestBody!.tags as string[])[0]
const noteId = (call: CapturedCall) => call.path.split('/')[4].split('?')[0]

// Match FIFO within each exact method/URL; composed detail reads can be concurrent.
function replay(selected: CapturedCall[]) {
  const pending = [...selected]
  const remote = createRemoteBackend({
    baseUrl: 'https://native-operations.invalid',
    fetchImpl: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      expect(url.origin).toBe('https://native-operations.invalid')
      const index = pending.findIndex((call) => call.method === request.method && call.path === url.pathname + url.search)
      expect(index, 'unrecorded method or URL').toBeGreaterThanOrEqual(0)
      const call = pending.splice(index, 1)[0]
      const requestText = await request.text()
      expect(requestText ? JSON.parse(requestText) : null).toEqual(call.requestBody)
      const headers = new Headers()
      if (call.contentType) headers.set('Content-Type', call.contentType)
      return new Response(call.status === 204 ? null : call.rawBody, { status: call.status, headers })
    },
  })
  return { remote, done: () => expect(pending.map((call) => call.method + ' ' + call.path)).toEqual([]) }
}

describe('producer native operation replay (#419/#420; not a new live run)', () => {
  it('binds fixture bytes and separates fixture source from runtime and published consumer', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256)
    expect(fixture.artifact.commit).toBe(pin.runtimeCommit)
    expect(fixture.executableSha256).toBe(pin.runtimeArtifact.sha256)
    expect(fixture.packageCommit).toBe(pin.publishedConsumer.commit)
    expect(fixture.packageSha256).toBe(pin.publishedConsumer.sha256)
    expect(fixture.probeSha256).toBe(pin.captureScript.sha256)
    expect(pin.fixtureCommit).not.toBe(pin.runtimeCommit)
    expect(fixture.checks).toHaveLength(23)
    expect(calls).toHaveLength(86)
    for (const call of calls) expect(createHash('sha256').update(call.rawBody).digest('hex')).toBe(call.responseSha256)
  })

  it('retains empty list and demonstrated adapter capabilities', async () => {
    const { remote, done } = replay(group('clean authenticated destination and capabilities'))
    expect(remote.capabilities).toMatchObject({ write: true, merge: false, semantic: 'server' })
    expect((await remote.listNotes()).total).toBe(0)
    done()
  })

  it('creates both notes with exact producer bodies and composes their contents', async () => {
    const { remote, done } = replay(group('create both synthetic notes through published adapter'))
    for (const call of created) {
      const input = call.requestBody!
      const result = await remote.manageNote({ action: 'create', title: input.title, content: input.content, tags: input.tags, source: input.source })
      expect(result.note_id).toBe(body(call).id)
      expect(await remote.getNoteFull!(result.note_id)).toMatchObject({ id: result.note_id, content: input.content })
    }
    done()
  })

  it('preserves q, AND tags and the actual EnhancedSearchHit projection with UTC enrichment', async () => {
    const { remote, done } = replay(group('authenticated FTS q AND-tags and actual EnhancedSearchHit projection'))
    expect(await remote.search('NEEDLE', { mode: 'fts', tags: [tag, 'selected'], limit: 10 })).toEqual(fixture.searchProjection.result)
    done()
  })

  it('keeps AND-tag nonmatches empty', async () => {
    const { remote, done } = replay(group('AND tags exclude nonmatching notes'))
    expect((await remote.search('NEEDLE', { tags: ['selected', 'excluded'], limit: 10 })).hits).toEqual([])
    done()
  })

  it('preserves the returned-hit total for an empty search', async () => {
    const { remote, done } = replay(group('empty FTS results preserve returned-hit total'))
    expect(await remote.search('NO_MATCH_PACKAGE_TERM', { limit: 10 })).toMatchObject({ total: 0, hits: [], degraded: false, totalKind: 'returned-hits' })
    done()
  })

  it('retains the limited hit and rank order', async () => {
    const selected = group('bounded FTS limit and rank order')
    const { remote, done } = replay(selected)
    const result = await remote.search('NEEDLE', { limit: 1 })
    expect(result.hits.map((hit) => hit.note.id)).toEqual(body(selected[0]).results.map((hit: { note_id: string }) => hit.note_id))
    expect(result.total).toBe(1)
    done()
  })

  it('explicitly reports semantic fallback, not successful vector retrieval', async () => {
    const { remote, done } = replay(group('semantic report explicitly retains unavailable-inference FTS fallback'))
    const result = await remote.semanticWithReport('NEEDLE', 10)
    expect(result).toMatchObject({ requestedMode: 'semantic', effectiveMode: 'fts', degraded: true, degradation: fixture.semanticDegradation })
    expect(result.hits.map((hit) => hit.note.id).sort()).toEqual([...ids].sort())
    done()
  })

  it('rejects fallback in the array-only semantic API', async () => {
    const { remote, done } = replay(group('array-only semantic rejects fallback'))
    await expect(remote.semantic!('NEEDLE', 10)).rejects.toMatchObject({ kind: 'degraded-search' })
    done()
  })

  it('retains hybrid degradation', async () => {
    const { remote, done } = replay(group('hybrid explicitly reports FTS degradation'))
    expect(await remote.search('NEEDLE', { mode: 'hybrid', limit: 10 })).toMatchObject({
      requestedMode: 'hybrid', effectiveMode: 'fts', degraded: true, degradation: fixture.semanticDegradation,
    })
    done()
  })

  it('rejects unsupported options and malformed intents before dispatch', async () => {
    const { remote, done } = replay([])
    for (const options of [{ offset: 1 }, { source: ['unsupported'] }]) {
      await expect(remote.search('NEEDLE', options)).rejects.toMatchObject({ kind: 'unsupported-operation' })
    }
    for (const limit of [0, 101]) await expect(remote.search('NEEDLE', { limit })).rejects.toMatchObject({ kind: 'invalid-request' })
    for (const input of [{ action: 'merge', note_id: first }, { action: 'update', note_id: first, title: 'unsupported' }]) {
      await expect(remote.manageNote(input)).rejects.toMatchObject({ kind: 'invalid-request' })
    }
    done()
  })

  it('retains the historical producer400 for the obsolete query parameter', () => {
    const [call] = group('actual producer rejects legacy missing-q request')
    expect(call.path).toBe('/api/v1/search?query=NEEDLE')
    expect(call.status).toBe(400)
    // This producer-only request is not injected into the corrected search adapter.
    expect(call.rawBody).toContain('q')
  })

  it.each(['missing', 'invalid'])('replays %s-identity errors for search and every mutation', async (identity) => {
    const { remote, done } = replay(group(identity + ' identity cannot search or dispatch advertised mutations'))
    const denied = { kind: 'http', status: 401, problemCode: 'unauthorized' }
    await expect(remote.search('NEEDLE')).rejects.toMatchObject(denied)
    await expect(remote.semanticWithReport('NEEDLE', 10)).rejects.toMatchObject(denied)
    const inputs = [
      { action: 'create', content: 'MUST NOT BE STORED' },
      { action: 'update', note_id: first, content: 'MUST NOT BE STORED' },
      ...['star', 'unstar', 'archive', 'unarchive', 'delete', 'restore'].map((action) => ({ action, note_id: first })),
    ]
    for (const input of inputs) {
      const error = await remote.manageNote(input).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(RemoteBackendError)
      expect(error).toMatchObject(denied)
    }
    expect(await remote.getNoteFull!(first)).toMatchObject({ content: 'PACKAGE REMOTE NEEDLE' })
    done()
  })

  it.each([
    ['star', 'starred', true], ['unstar', 'starred', false],
    ['archive', 'archived', true], ['unarchive', 'archived', false],
  ] as const)('replays persisted %s state', async (action, field, expected) => {
    const { remote, done } = replay(group('authenticated ' + action + ' persists expected state'))
    expect(await remote.manageNote({ action, note_id: first })).toMatchObject({ note: { [field]: expected } })
    expect(await remote.getNote(first)).toMatchObject({ [field]: expected })
    done()
  })

  it('projects updated content through mutation and composed read', async () => {
    const { remote, done } = replay(group('authenticated content update persists through composed read'))
    expect(await remote.manageNote({ action: 'update', note_id: first, content: 'PACKAGE UPDATED' })).toMatchObject({ note: { content: 'PACKAGE UPDATED' } })
    expect(await remote.getNoteFull!(first)).toMatchObject({ content: 'PACKAGE UPDATED' })
    done()
  })

  it('preserves updated tags and resulting search membership', async () => {
    const { remote, done } = replay(group('authenticated tag update persists and changes search membership'))
    const result = await remote.manageNote({ action: 'update', note_id: first, tags: [tag, 'updated'] })
    expect(result).toMatchObject({ note: { tags: expect.arrayContaining([tag, 'updated']) } })
    expect(await remote.getNote(first)).toMatchObject({ tags: expect.arrayContaining([tag, 'updated']) })
    expect((await remote.search('UPDATED', { tags: ['updated'], limit: 10 })).hits.map((hit) => hit.note.id)).toEqual([first])
    expect((await remote.search('UPDATED', { tags: ['selected'], limit: 10 })).total).toBe(0)
    done()
  })

  it('maps successful deletion to authoritative absence', async () => {
    const { remote, done } = replay(group('authenticated delete yields authoritative absence'))
    expect(await remote.manageNote({ action: 'delete', note_id: first })).toMatchObject({ action: 'delete', note_id: first })
    expect(await remote.getNote(first)).toBeNull()
    expect((await remote.listNotes()).total).toBe(1)
    done()
  })

  it('restores with the exact query and preserves identity and content', async () => {
    const { remote, done } = replay(group('authenticated restore preserves content and identity'))
    expect(await remote.manageNote({ action: 'restore', note_id: first })).toMatchObject({ action: 'restore', note_id: first })
    expect(await remote.getNoteFull!(first)).toMatchObject({ id: first, content: 'PACKAGE UPDATED' })
    expect((await remote.listNotes()).total).toBe(2)
    done()
  })

  it('keeps mutation404 a typed failure', async () => {
    const selected = group('mutation404 is typed failure not false success')
    const { remote, done } = replay(selected)
    await expect(remote.manageNote({ action: 'update', note_id: noteId(selected[0]), content: 'MISSING' })).rejects.toMatchObject({
      kind: 'http', status: 404, problemCode: 'not-found',
    })
    done()
  })

  it('replays lifecycle cleanup without claiming current host state', async () => {
    const { remote, done } = replay(group('synthetic lifecycle cleanup verifies both tombstones and no visible notes'))
    for (const id of ids) await remote.manageNote({ action: 'delete', note_id: id })
    expect((await remote.listNotes()).total).toBe(0)
    for (const id of ids) expect(await remote.getNote(id)).toBeNull()
    done()
  })
})
