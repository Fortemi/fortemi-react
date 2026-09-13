import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { bindSearchEvidence, MAX_EVIDENCE_BYTES } from '../search-evidence.js'
import vectors from '../../schemas/metadata-search/candidate/1.0.0/evidence-resolution-vectors.json' with { type: 'json' }
import { isEvidenceResolveRequest, isEvidenceResolveResponse } from '../remote-search-schema.js'

const id = '00000000-0000-4000-8000-000000000001'
const raw = '\ufeffa\r\n\u{1f680}e\u0301'
const bytes = new TextEncoder()
const source = { namespace: 'fixture', external_id_hash: 'sha256:' + 'a'.repeat(64), import_run_id: 'run', schema_version: '1' }
const locator = (kind: 'current' | 'title' | 'attachment' | 'embedding' = 'current', start = 0, end = bytes.encode(raw).length) =>
  bindSearchEvidence({ note_id: id, unit: { kind, id, index: kind === 'embedding' ? 7 : 0 }, content: raw, source }, start, end)
const response = (value: unknown = { text: raw }, headers: HeadersInit = { 'cache-control': 'no-store' }) => Response.json(value, { headers })
const backend = (fetchImpl: typeof fetch) => createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid', fetchImpl })

afterEach(() => vi.useRealTimers())

describe('remote current-storage evidence resolution', () => {
  it.each(vectors.requests)('shared producer request $id', ({ value, valid }) => {
    expect(isEvidenceResolveRequest(value)).toBe(valid)
  })
  it.each(vectors.responses)('shared producer response $id', ({ value, valid }) => {
    expect(isEvidenceResolveResponse(value)).toBe(valid)
  })
  it.each(['current', 'title', 'attachment', 'embedding'] as const)('resolves exact %s bytes through one POST, not note details', async kind => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response())
    const headers = vi.fn(async () => ({ 'X-Fortemi-Memory': 'fixture-archive', Authorization: 'Bearer overridden' }))
    const remote = createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid', fetchImpl, headers, authToken: 'synthetic-token' })
    const value = locator(kind)
    await expect(remote.resolveEvidence(value, { metadataPredicates: [{ path: 'provider', op: 'eq', value: 'fixture' }], includeArchived: true })).resolves.toBe(raw)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://synthetic-resolution.invalid/api/v1/search/evidence/resolve')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-token')
    expect(new Headers(init?.headers).get('x-fortemi-memory')).toBe('fixture-archive')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ locator: value, metadata_predicates: [{ path: 'provider', op: 'eq', value: 'fixture' }], include_archived: true })
    expect(headers).toHaveBeenCalledTimes(1)
    expect(remote.capabilities.evidenceLocators).toBe(false)
    expect(remote.capabilities.typedMetadataPredicates).toBe(false)
  })

  it.each([[6, 10, '\u{1f680}'], [3, 3, '']] as const)('returns a partial or empty span %i..%i', async (start, end, text) => {
    await expect(backend(async () => response({ text })).resolveEvidence(locator('current', start, end))).resolves.toBe(text)
  })

  it.each([null, [], 'private', { tenant_id: 'tenant' }, { archive_id: 'archive' }, { visibility: 'private' }, { includeArchived: null }, { include_archived: true }, { metadataPredicates: null }, { metadataPredicates: [{ path: 'provider', op: 'range', gte: 'z', lte: 'a' }] }, { signal: {} }])('rejects invalid or unsupported options before header lookup: %j', async options => {
    const fetchImpl = vi.fn<typeof fetch>()
    const headers = vi.fn(() => ({}))
    const remote = createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid', fetchImpl, headers })
    await expect(remote.resolveEvidence(locator(), options as never)).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(headers).not.toHaveBeenCalled()
  })

  it.each([null, {}, { ...locator(), private: 'PRIVATE_INPUT' }, { ...locator(), span: { unit: 'utf8-bytes', start: 9, end: 8 } }])('rejects malformed locator before I/O', async value => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(backend(fetchImpl).resolveEvidence(value)).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([null, {}, { text: 1 }, { text: raw, private: 'PRIVATE_BODY' }, { text: 'x' }, { text: '\ud800'.repeat(bytes.encode(raw).length / 3) }])('rejects malformed or wrong-length text without retaining response', async value => {
    try { await backend(async () => response(value)).resolveEvidence(locator()); expect.fail('accepted') } catch (error) {
      expect(error).toMatchObject({ kind: 'invalid-response' })
      expect(error).not.toHaveProperty('cause')
      expect(String(error)).not.toContain('PRIVATE_BODY')
    }
  })

  it.each<HeadersInit>([{}, { 'cache-control': 'private' }, { 'cache-control': 'no-store', 'content-type': 'text/plain' }])('requires JSON and no-store response headers', async headers => {
    await expect(backend(async () => response({ text: raw }, headers)).resolveEvidence(locator())).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it.each([400, 401, 403, 404, 429, 500])('preserves bounded HTTP status %i without error-body reads', async status => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    await expect(backend(async () => new Response(body, { status })).resolveEvidence(locator())).rejects.toMatchObject({ kind: 'http', status })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('bounds response bytes even without a Content-Length header', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(1024)) }, cancel })
    await expect(backend(async () => new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })).resolveEvidence(locator())).rejects.toMatchObject({ kind: 'invalid-response' })
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects spans above the producer byte budget before I/O', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(backend(fetchImpl).resolveEvidence({ ...locator(), span: { unit: 'utf8-bytes', start: 0, end: MAX_EVIDENCE_BYTES + 1 } })).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('enforces the encoded request bound even for schema-valid metadata', async () => {
    const metadataPredicates = Array.from({ length: 8 }, () => ({ path: 'provider' as const, op: 'in' as const, value: Array(32).fill('\u{1f680}'.repeat(256)) as string[] }))
    expect(isEvidenceResolveRequest({ locator: locator(), metadata_predicates: metadataPredicates })).toBe(true)
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(backend(fetchImpl).resolveEvidence(locator(), { metadataPredicates })).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('revalidates serialized metadata before headers or I/O', async () => {
    const metadataPredicates = Object.assign([], { toJSON: () => null })
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(backend(fetchImpl).resolveEvidence(locator(), { metadataPredicates })).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('captures immutable input before async header evaluation', async () => {
    const value = structuredClone(locator())
    const options = { metadataPredicates: [{ path: 'provider' as const, op: 'eq' as const, value: 'before' }] }
    const fetchImpl = vi.fn<typeof fetch>(async () => response())
    const remote = createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid', fetchImpl, headers: async () => {
      options.metadataPredicates[0].value = 'after'
      Object.assign(value, { content_digest: 'sha256:' + '0'.repeat(64) })
      return {}
    } })
    await remote.resolveEvidence(value, options)
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.locator.content_digest).toBe(locator().content_digest)
    expect(body.metadata_predicates[0].value).toBe('before')
  })

  it('accepts tiny chunks splitting UTF-8 code points without normalization', async () => {
    const body = bytes.encode(JSON.stringify({ text: raw }))
    let index = 0
    const stream = new ReadableStream<Uint8Array>({ pull(c) {
      if (index < body.length) c.enqueue(body.subarray(index, ++index))
      else c.close()
    } })
    await expect(backend(async () => new Response(stream, { headers: { 'content-type': 'Application/JSON; charset=utf-8', 'cache-control': 'private, NO-STORE' } })).resolveEvidence(locator())).resolves.toBe(raw)
  })

  it.each(['-1', '99999999999999999999999999', 'invalid'])('rejects invalid or oversized Content-Length %s', async length => {
    await expect(backend(async () => response({ text: raw }, { 'cache-control': 'no-store', 'content-length': length })).resolveEvidence(locator())).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('allows JSON control-character escaping within the bound', async () => {
    const text = '\u0000'.repeat(1000)
    const value = bindSearchEvidence({ note_id: id, unit: { kind: 'current', id, index: 0 }, content: text }, 0, 1000)
    await expect(backend(async () => response({ text })).resolveEvidence(value)).resolves.toBe(text)
  })

  it.each(['{PRIVATE_JSON', new Uint8Array([0xff, 0xff])])('rejects invalid JSON or UTF-8 bodies', async body => {
    await expect(backend(async () => new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })).resolveEvidence(locator())).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('cancels a body read on caller abort without retaining the abort reason', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start() { queueMicrotask(() => controller.abort('PRIVATE_ABORT')) }, cancel }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }))
    await expect(backend(fetchImpl).resolveEvidence(locator(), { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted', message: 'Remote backend aborted.' })
    expect(cancel).toHaveBeenCalled()
  })

  it('redacts rejected headers and transport exceptions', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('PRIVATE_TRANSPORT') })
    await expect(backend(fetchImpl).resolveEvidence(locator())).rejects.toMatchObject({ kind: 'transport', message: 'Remote backend transport.' })
    const remote = createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid', fetchImpl, headers: () => { throw new Error('PRIVATE_HEADERS') } })
    await expect(remote.resolveEvidence(locator())).rejects.toMatchObject({ kind: 'transport', message: 'Remote backend transport.' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not call headers or transport with an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort('PRIVATE_REASON')
    const fetchImpl = vi.fn<typeof fetch>()
    const headers = vi.fn(() => ({}))
    const remote = createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid', fetchImpl, headers })
    await expect(remote.resolveEvidence(locator(), { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(headers).not.toHaveBeenCalled()
  })

  it.each(['headers', 'fetch', 'body'])('bounds a stalled %s stage by the operation deadline', async stage => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const remote = createRemoteBackend({ baseUrl: 'https://synthetic-resolution.invalid',
      headers: stage === 'headers' ? () => new Promise(() => {}) : undefined,
      fetchImpl: stage === 'fetch' ? () => new Promise(() => {}) : async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }),
    })
    const check = expect(remote.resolveEvidence(locator())).rejects.toMatchObject({ kind: 'aborted' })
    await vi.advanceTimersByTimeAsync(30_001)
    await check
    if (stage === 'body') expect(cancel).toHaveBeenCalled()
  })
})
