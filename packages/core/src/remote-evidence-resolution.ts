import { RemoteBackendError } from './remote-error.js'
import { MAX_EVIDENCE_BYTES, parseSearchEvidenceLocator } from './search-evidence.js'
import { validateMetadataPredicates } from './repositories/metadata-predicates.js'
import type { MetadataPredicate } from './repositories/metadata-predicates.js'
import { isEvidenceResolveRequest, isEvidenceResolveResponse } from './remote-search-schema.js'

export interface RemoteEvidenceResolutionOptions {
  metadataPredicates?: readonly MetadataPredicate[]
  includeArchived?: boolean
  /** Cancels header lookup, transport and response reading; a 30-second ceiling also applies. */
  signal?: AbortSignal
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const invalidRequest = () => new RemoteBackendError('invalid-request')
const invalidResponse = () => new RemoteBackendError('invalid-response')

function prepare(value: unknown, options: RemoteEvidenceResolutionOptions = {}) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
      || Reflect.ownKeys(options).some(key => !['metadataPredicates', 'includeArchived', 'signal'].includes(String(key)))) throw invalidRequest()
    const locator = parseSearchEvidenceLocator(value)
    if (locator.span.end > MAX_EVIDENCE_BYTES) throw invalidRequest()
    const metadata = Object.hasOwn(options, 'metadataPredicates') ? options.metadataPredicates : undefined
    const archived = Object.hasOwn(options, 'includeArchived') ? options.includeArchived : undefined
    const signal = Object.hasOwn(options, 'signal') ? options.signal : undefined
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw invalidRequest()
    if (metadata !== undefined) validateMetadataPredicates(metadata)
    const request = { locator, ...(metadata === undefined ? {} : { metadata_predicates: metadata }),
      ...(archived === undefined ? {} : { include_archived: archived }) }
    if (!isEvidenceResolveRequest(request)) throw invalidRequest()
    // Serialize before awaiting caller-supplied headers so later mutation cannot change the request.
    const body = JSON.stringify(request)
    if (encoder.encode(body).length > 65536) throw invalidRequest()
    // Validate actual wire bytes too: caller-owned arrays can define toJSON.
    const wire = JSON.parse(body)
    if (!isEvidenceResolveRequest(wire)) throw invalidRequest()
    const encoded = wire as { locator: unknown; metadata_predicates?: unknown }
    parseSearchEvidenceLocator(encoded.locator)
    if (encoded.metadata_predicates !== undefined) validateMetadataPredicates(encoded.metadata_predicates)
    return { body, signal, length: locator.span.end - locator.span.start }
  } catch { throw invalidRequest() }
}

/** The producer validates full-text identity. A partial response can only be checked for wire shape and span length here. */
export async function resolveRemoteEvidence(
  value: unknown,
  options: RemoteEvidenceResolutionOptions | undefined,
  send: (body: string, signal: AbortSignal) => Promise<Response>,
): Promise<string> {
  const prepared = prepare(value, options)
  if (prepared.signal?.aborted) throw new RemoteBackendError('aborted')
  const controller = new AbortController()
  const abort = () => controller.abort()
  prepared.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 30_000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let completed = false
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new RemoteBackendError('aborted')) })
  controller.signal.addEventListener('abort', rejectAbort, { once: true })
  async function perform(): Promise<string> {
    const response = await send(prepared.body, controller.signal)
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {})
      throw new RemoteBackendError('aborted')
    }
    reader = response.body?.getReader()
    // No server error text is needed to retain the existing bounded HTTP-status classification.
    if (!response.ok) throw new RemoteBackendError('http', response.status)
    if (response.status !== 200 || !reader
      || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
      || !response.headers.get('cache-control')?.split(',').some(part => part.trim().toLowerCase() === 'no-store')) throw invalidResponse()
    // Each cited UTF-8 byte can require at most six JSON escape bytes; allow the fixed envelope too.
    const maximum = prepared.length * 6 + 64
    const advertised = response.headers.get('content-length')
    if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > maximum)) throw invalidResponse()
    let bytes = new Uint8Array(Math.min(maximum, 4096))
    let length = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) { completed = true; break }
      const nextLength = length + chunk.byteLength
      if (nextLength > maximum) throw invalidResponse()
      if (nextLength > bytes.length) {
        const grown = new Uint8Array(Math.min(maximum, Math.max(nextLength, bytes.length * 2)))
        grown.set(bytes.subarray(0, length))
        bytes = grown
      }
      bytes.set(chunk, length)
      length = nextLength
    }
    let data: unknown
    try { data = JSON.parse(decoder.decode(bytes.subarray(0, length))) } catch { throw invalidResponse() }
    if (!isEvidenceResolveResponse(data)) throw invalidResponse()
    const text = (data as { text: string }).text
    if (text.length > prepared.length) throw invalidResponse()
    const textBytes = encoder.encode(text)
    if (textBytes.length !== prepared.length || decoder.decode(textBytes) !== text) throw invalidResponse()
    return text
  }
  try { return await Promise.race([perform(), aborted]) } catch (error) {
    if (error instanceof RemoteBackendError) throw error
    throw new RemoteBackendError(controller.signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'aborted' : 'transport')
  } finally {
    clearTimeout(timer)
    prepared.signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', rejectAbort)
    controller.abort()
    if (reader) {
      if (!completed) void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}
