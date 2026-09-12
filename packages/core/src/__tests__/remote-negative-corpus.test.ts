import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRemoteBackend } from '../data-backend.js'
import { RemoteBackendError } from '../remote-error.js'

interface Control {
  id: string
  stage: 'note' | 'links' | 'concepts' | 'provenance'
  mode: 'body' | 'reset' | 'abort' | 'truncate' | 'proxy404' | 'mismatched404' | 'problem'
  rawBody?: string
  nativeStatus?: number
  expectedKind: 'http' | 'transport' | 'aborted' | 'invalid-response'
}
interface Capture { check: string; path: string; rawBody: string; status: number; contentType: string; retryAfter: string | null }
const directory = new URL('./fixtures/', import.meta.url)
const bytes = readFileSync(new URL('remote-negative-controls.json', directory))
const corpus = JSON.parse(bytes.toString('utf8'))
const pin = JSON.parse(readFileSync(new URL('remote-negative-controls.producer-pin.json', directory), 'utf8'))
const receipt = JSON.parse(readFileSync(new URL('remote-negative-package.receipt.json', directory), 'utf8'))
const native = JSON.parse(readFileSync(new URL('native-remote-auth.json', directory), 'utf8'))
const controls: Control[] = corpus.controls
const calls: Capture[] = native.calls
const composed = calls.filter(call => call.check === 'composed existing note remains accessible')
const detail = composed.find(call => !/\/(links|concepts|provenance)$/.test(call.path))!
const id = detail.path.split('/').at(-1)!
const capturedResponse = (call: Capture) => new Response(call.rawBody, { status: call.status,
  headers: { 'Content-Type': call.contentType, ...(call.retryAfter ? { 'Retry-After': call.retryAfter } : {}) } })
const cases = controls.flatMap(control => (control.stage === 'note' ? ['getNote', 'getNoteFull'] as const : ['getNoteFull'] as const)
  .map(method => ({ control, method })))

describe('producer-owned negative corpus replay (#421; transport injection, not a live run)', () => {
  it('pins the corpus and preserves the separate published-package loopback receipt', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256)
    expect(corpus.classification).toBe('producer-owned-controlled-fault-injection')
    expect(corpus.claims).toEqual({ liveFortemiServer: false, hostedNoteDenial: false, inference: false, suiteParity: false })
    expect(receipt.fixtureSha256).toBe(pin.sha256)
    expect(receipt.packageSha256).toBe(pin.publishedConsumer.sha256)
    expect(receipt.checks.map((check: { id: string; readMethod: string }) => `${check.id}/${check.readMethod}`))
      .toEqual(cases.map(({ control, method }) => `${control.id}/${method}`))
    expect(cases).toHaveLength(31)
  })

  it.each(cases)('$control.id via $method', async ({ control, method }) => {
    const target = control.stage === 'note' ? detail.path : `${detail.path}/${control.stage}`
    const problem = control.mode === 'problem' ? calls.find(call => call.status === control.nativeStatus)! : undefined
    let armed = false
    let injected = 0
    const remote = createRemoteBackend({ baseUrl: 'https://negative-replay.invalid', fetchImpl: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      expect(url.origin).toBe('https://negative-replay.invalid')
      expect(request.method).toBe('GET')
      expect(url.search).toBe('')
      const call = composed.find(call => call.path === url.pathname)
      expect(call, 'unexpected consumer route').toBeDefined()
      if (!armed || url.pathname !== target) return capturedResponse(call!)
      injected++
      // Replay socket/abort/body failures; actual loopback execution is in the producer receipt.
      if (control.mode === 'reset') throw new TypeError('SYNTHETIC-PRIVATE-SOCKET')
      if (control.mode === 'abort') throw new DOMException('SYNTHETIC-PRIVATE-ABORT', 'AbortError')
      if (control.mode === 'truncate') return new Response(new ReadableStream({ start(controller) {
        controller.error(new TypeError('SYNTHETIC-PRIVATE-TRUNCATION'))
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (control.mode === 'body') return new Response(control.rawBody, { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (control.mode === 'proxy404') return new Response('SYNTHETIC-PRIVATE-PROXY', { status: 404 })
      if (control.mode === 'mismatched404') return Response.json({ status: 500, type: 'https://fortemi.com/problems/not-found', detail: 'SYNTHETIC-PRIVATE-DETAIL' }, {
        status: 404, headers: { 'Content-Type': 'application/problem+json' },
      })
      expect(problem).toBeDefined()
      return capturedResponse(problem!)
    } })
    if (control.stage !== 'note') await expect(remote.getNote(id)).resolves.toMatchObject({ id })
    armed = true
    const error = await remote[method]!(id).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(RemoteBackendError)
    expect(error).toMatchObject({ kind: control.expectedKind })
    expect(injected).toBe(1)
    if (problem) {
      const source = JSON.parse(problem.rawBody)
      expect(error).toMatchObject({ status: problem.status, problemCode: source.type.split('/').at(-1), requestId: source.request_id,
        retryAfterSeconds: problem.status === 429 ? 60 : undefined })
      expect(JSON.stringify(error)).not.toContain(source.detail)
    }
    if (control.mode === 'proxy404' || control.mode === 'mismatched404') expect(error).toMatchObject({ status: 404, problemCode: undefined })
    for (const output of [String(error), JSON.stringify(error)]) {
      expect(output).not.toContain('SYNTHETIC-PRIVATE')
      expect(output).not.toContain('negative-replay.invalid')
    }
  })
})
