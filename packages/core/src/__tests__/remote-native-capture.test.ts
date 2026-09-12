import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { RemoteBackendError } from '../remote-error.js'

interface CapturedCall {
  check: string
  method: string
  path: string
  status: number
  contentType: string
  retryAfter: string | null
  rawBody: string
  responseSha256: string
}

const directory = new URL('./fixtures/', import.meta.url)
const bytes = readFileSync(new URL('native-remote-auth.json', directory))
const fixture = JSON.parse(bytes.toString('utf8'))
const pin = JSON.parse(readFileSync(new URL('native-remote-auth.producer-pin.json', directory), 'utf8'))
const calls: CapturedCall[] = fixture.calls
const group = (check: string) => calls.filter((call) => call.check === check)
const body = (call: CapturedCall) => JSON.parse(call.rawBody)
const noteId = (call: CapturedCall) => call.path.split('/')[4]
const response = (call: CapturedCall) => {
  const headers = new Headers({ 'Content-Type': call.contentType })
  if (call.retryAfter !== null) headers.set('Retry-After', call.retryAfter)
  return new Response(call.rawBody, { status: call.status, headers })
}

// Enrichment can run concurrently; retain FIFO order within each exact method/path.
function replay(selected: CapturedCall[]) {
  expect(selected.length).toBeGreaterThan(0)
  const pending = [...selected]
  const remote = createRemoteBackend({
    baseUrl: 'https://native-capture.invalid',
    fetchImpl: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      expect(url.origin).toBe('https://native-capture.invalid')
      const index = pending.findIndex((call) => call.method === request.method && call.path === url.pathname + url.search)
      expect(index, `unexpected replay request: ${request.method} ${url.pathname}${url.search}`).toBeGreaterThanOrEqual(0)
      return response(pending.splice(index, 1)[0])
    },
  })
  return { remote, done: () => expect(pending.map((call) => `${call.method} ${call.path}`)).toEqual([]) }
}

describe('native producer raw-response replay (#417, #418, #421; not a new live run)', () => {
  it('binds raw bytes and keeps fixture source, runtime and historical published consumer distinct', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256)
    expect(fixture.artifact.commit).toBe(pin.runtimeCommit)
    expect(fixture.executableSha256).toBe(pin.runtimeArtifact.sha256)
    expect(fixture.packageCommit).toBe(pin.publishedConsumer.commit)
    expect(fixture.packageSha256).toBe(pin.publishedConsumer.sha256)
    expect(pin.fixtureCommit).not.toBe(pin.runtimeCommit)
    expect(fixture.health.git_sha).toBe('unknown')
    expect(calls).toHaveLength(86)
    for (const call of calls) {
      expect(createHash('sha256').update(call.rawBody).digest('hex')).toBe(call.responseSha256)
    }
  })

  it.each(['empty authenticated list', 'nonempty authenticated list'])('replays %s at its exact URL', async (check) => {
    const selected = group(check)
    const { remote, done } = replay(selected)
    const source = body(selected[0])
    const result = await remote.listNotes(check.startsWith('empty') ? undefined : { limit: 10 })
    expect(result).toEqual({ total: source.total, items: source.notes.map((note: Record<string, unknown>) => ({
      id: note.id, title: note.title, tags: note.tags, starred: note.starred, archived: note.archived,
      createdAt: note.created_at_utc, updatedAt: note.updated_at_utc,
    })) })
    done()
  })

  it('preserves note identity, UTC timestamps and tags', async () => {
    const selected = group('note identity UTC tags')
    const { remote, done } = replay(selected)
    const source = body(selected[0])
    await expect(remote.getNote(noteId(selected[0]))).resolves.toEqual({
      id: source.note.id, title: source.note.title, tags: source.tags, source: source.note.source,
      createdAt: source.note.created_at_utc, updatedAt: source.note.updated_at_utc,
      starred: source.note.starred, archived: source.note.archived,
    })
    done()
  })

  it('preserves incoming/outgoing endpoints and timestamps', async () => {
    const selected = group('directional relationship reads')
    const { remote, done } = replay(selected)
    for (const call of selected) {
      const source = body(call)
      await expect(remote.linksOf!(noteId(call))).resolves.toEqual(['outgoing', 'incoming'].flatMap((direction) =>
        source[direction].map((link: Record<string, unknown>) => ({
          id: link.id, fromNoteId: link.from_note_id, toNoteId: link.to_note_id, toUrl: link.to_url,
          kind: link.kind, score: link.score, createdAt: link.created_at_utc, snippet: link.snippet,
          remoteMetadata: link.metadata, direction,
        }))))
    }
    done()
  })

  it.each(['composed existing note remains accessible', 'seeded nonempty provenance and revised content'])(
    'replays composition: %s', async (check) => {
      const selected = group(check)
      const { remote, done } = replay(selected)
      const id = noteId(selected[0])
      if (check.startsWith('seeded')) {
        const graph = await remote.provenanceGraphOf!(id)
        expect(graph).toEqual(body(selected[0]))
        expect(graph.all_edges).toHaveLength(1)
        expect(graph.all_activities).toHaveLength(1)
      }
      const detail = body(selected.find((call) => call.path === `/api/v1/notes/${id}`)!)
      const graph = body([...selected].reverse().find((call) => call.path.endsWith('/provenance'))!)
      const note = await remote.getNoteFull!(id)
      expect(note).toMatchObject({ id, content: detail.revised.content, tags: detail.tags,
        createdAt: detail.note.created_at_utc, updatedAt: detail.note.updated_at_utc, provenanceGraph: graph })
      expect(note?.links).toHaveLength(1)
      expect(note?.concepts).toHaveLength(1)
      expect(note?.concepts?.[0]).toMatchObject({ prefLabel: 'lane-b-live-read', unavailableFields: ['altLabels', 'definition'] })
      expect(note?.provenance).toBeUndefined()
      done()
    },
  )

  it('maps captured authoritative absence to null through both reads', async () => {
    const selected = group('authenticated authoritative not-found')
    const { remote, done } = replay(selected)
    await expect(remote.getNote(noteId(selected[0]))).resolves.toBeNull()
    await expect(remote.getNoteFull!(noteId(selected[1]))).resolves.toBeNull()
    done()
  })

  it.each([
    ['missing identity', 401, 'unauthorized'],
    ['invalid identity', 401, 'unauthorized'],
    ['real producer500 from reversible private database fault', 500, 'internal-error'],
    ['real rate limit429 reaches installed consumer', 429, 'rate-limit-exceeded'],
  ] as const)('replays captured %s diagnostics through both reads', async (check, status, problemCode) => {
    // Select the two actual failure responses, without simulating a new rate-limit/fault event.
    const selected = group(check).filter((call) => call.status === status)
    expect(selected).toHaveLength(2)
    const { remote, done } = replay(selected)
    for (const [index, read] of [remote.getNote, remote.getNoteFull!].entries()) {
      const call = selected[index]
      const error = await read(noteId(call)).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(RemoteBackendError)
      expect(error).toMatchObject({ kind: 'http', status, problemCode, requestId: body(call).request_id,
        retryAfterSeconds: status === 429 ? 60 : undefined })
      expect(String(error)).not.toContain(body(call).detail)
      expect(JSON.stringify(error)).not.toContain(body(call).detail)
    }
    done()
  })

  it('replays the successful read after the captured private database fault was restored', async () => {
    const selected = group('real producer500 from reversible private database fault').filter((call) => call.status === 200)
    const { remote, done } = replay(selected)
    await expect(remote.getNote(noteId(selected[0]))).resolves.toMatchObject({ id: noteId(selected[0]) })
    done()
  })

  it('preserves personal AllowAllPolicy read success without claiming hosted scope enforcement', async () => {
    const selected = group('personal AllowAllPolicy permits authenticated MCP-scoped note read')
    const { remote, done } = replay(selected)
    const id = noteId(selected[0])
    await expect(remote.getNote(id)).resolves.toMatchObject({ id })
    await expect(remote.getNoteFull!(id)).resolves.toMatchObject({ id })
    done()
  })

  it('injects the captured operator403 into note transports; this is NOT a live note denial', async () => {
    const [call] = group('producer operator inventory denies non-admin identity')
    expect(call.path).toBe('/api/v1/operator/openapi.yaml')
    expect(call.status).toBe(403)
    const remote = createRemoteBackend({ baseUrl: 'https://operator403-injection.invalid', fetchImpl: async () => response(call) })
    const id = noteId(group('note identity UTC tags')[0])
    for (const read of [remote.getNote, remote.getNoteFull!]) {
      await expect(read(id)).rejects.toMatchObject({ kind: 'http', status: 403, problemCode: 'forbidden', requestId: body(call).request_id })
    }
  })
})
