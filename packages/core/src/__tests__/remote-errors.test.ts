import { describe, expect, it } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { RemoteBackendError } from '../remote-error.js'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const note = {
  note: { id, title: 'Synthetic note', created_at_utc: '2026-09-10T00:00:00Z', updated_at_utc: '2026-09-10T00:00:00Z', source: 'test', starred: false, archived: false },
  tags: [], original: { content: 'original' }, revised: { content: '' },
}
const problem = (status: number, code: string) => Response.json({
  type: `https://fortemi.com/problems/${code}`, status, detail: 'PRIVATE-RESPONSE',
  instance: '/PRIVATE-PATH', request_id: id,
}, { status, headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '30' } })
const backend = (fetchImpl: typeof fetch) => createRemoteBackend({ baseUrl: 'https://fixture.invalid/PRIVATE-BASE', fetchImpl })

describe('remote failure handling (synthetic fault injection, not producer conformance)', () => {
  it.each([[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate-limit-exceeded'], [500, 'internal-error'], [503, 'service-unavailable']] as const)(
    'preserves bounded HTTP %i diagnostics without response content', async (status, code) => {
      const remote = backend(async () => problem(status, code))
      for (const read of [remote.getNote, remote.getNoteFull!]) {
        const error = await read(id).catch((error: unknown) => error)
        expect(error).toBeInstanceOf(RemoteBackendError)
        expect(error).toMatchObject({ kind: 'http', status, problemCode: code, requestId: id, retryAfterSeconds: 30 })
        expect(JSON.stringify(error)).not.toContain('PRIVATE')
        expect(String(error)).not.toContain('PRIVATE')
      }
    },
  )

  it('returns null only for the recognized note not-found response', async () => {
    const remote = backend(async () => problem(404, 'not-found'))
    await expect(remote.getNote(id)).resolves.toBeNull()
    await expect(remote.getNoteFull!(id)).resolves.toBeNull()
    await expect(backend(async () => new Response('proxy failure', { status: 404 })).getNote(id))
      .rejects.toMatchObject({ kind: 'http', status: 404, problemCode: undefined })
    await expect(backend(async () => problem(404, 'PRIVATE-CODE')).getNote(id))
      .rejects.toMatchObject({ kind: 'http', status: 404, problemCode: undefined })
  })

  it.each(['network', 'abort'])('bounds %s failures', async (kind) => {
    const remote = backend(async () => {
      const error = new Error('PRIVATE-URL-AND-TOKEN')
      if (kind === 'abort') error.name = 'AbortError'
      throw error
    })
    await expect(remote.getNote(id)).rejects.toMatchObject({ kind: kind === 'abort' ? 'aborted' : 'transport' })
    await expect(remote.getNoteFull!(id)).rejects.not.toHaveProperty('cause')
  })

  it.each(['not-json', '{}', 'null', '[]'])('rejects malformed success %s', async (body) => {
    const remote = backend(async () => new Response(body, { status: 200 }))
    await expect(remote.getNote(id)).rejects.toBeInstanceOf(RemoteBackendError)
    await expect(remote.getNoteFull!(id)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it.each([403, 404, 500])('does not turn enrichment HTTP %i into note absence', async (status) => {
    const remote = backend(async (url) => new URL(String(url)).pathname.endsWith('/links')
      ? problem(status, status === 404 ? 'not-found' : status === 403 ? 'forbidden' : 'internal-error')
      : Response.json(new URL(String(url)).pathname.endsWith(id) ? note
        : new URL(String(url)).pathname.endsWith('/provenance')
          ? { note_id: id, current_chain: null, all_activities: [], all_edges: [], derived_notes: [], derived_count: 0 }
          : []))
    await expect(remote.getNote(id)).resolves.toMatchObject({ id })
    await expect(remote.getNoteFull!(id)).rejects.toMatchObject({ kind: 'http', status })
  })

  it('rejects malformed enrichment instead of returning null', async () => {
    const remote = backend(async (url) => Response.json(new URL(String(url)).pathname.endsWith(id) ? note : {}))
    await expect(remote.getNoteFull!(id)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('does not retain oversized problem bodies or unbounded retry metadata', async () => {
    const remote = backend(async () => Response.json({ type: 'https://fortemi.com/problems/forbidden', status: 403, detail: 'x'.repeat(9000) }, {
      status: 403, headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '999999999999' },
    }))
    await expect(remote.getNote(id)).rejects.toMatchObject({ kind: 'http', status: 403, problemCode: undefined, retryAfterSeconds: undefined })
  })
})
