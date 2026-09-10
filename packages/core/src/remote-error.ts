export type RemoteBackendErrorKind = 'http' | 'transport' | 'aborted' | 'invalid-response' | 'unsupported-operation'

/** Bounded diagnostics only: never retains request URLs, headers or response text. */
export class RemoteBackendError extends Error {
  readonly name = 'RemoteBackendError'

  constructor(
    readonly kind: RemoteBackendErrorKind,
    readonly status?: number,
    readonly problemCode?: string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Remote backend ${kind}${status === undefined ? '' : ` (${status})`}.`)
  }
}

const PROBLEM_CODES = new Set([
  'validation-error', 'unauthorized', 'forbidden', 'not-found', 'gone', 'conflict',
  'rate-limit-exceeded', 'internal-error', 'operation-failed', 'provider-failure',
  'service-unavailable', 'blob-missing',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function boundedProblem(response: Response): Promise<Record<string, unknown>> {
  if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/problem+json') return {}
  const reader = response.body?.getReader()
  if (!reader) return {}
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 8192) {
        await reader.cancel()
        return {}
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  } finally { reader.releaseLock() }
}

export async function remoteHttpError(response: Response): Promise<RemoteBackendError> {
  const problem = await boundedProblem(response)
  const prefix = 'https://fortemi.com/problems/'
  const code = typeof problem.type === 'string' && problem.type.startsWith(prefix) ? problem.type.slice(prefix.length) : ''
  const validProblem = problem.status === response.status && PROBLEM_CODES.has(code)
  const retry = response.headers.get('retry-after')
  const retrySeconds = retry && /^\d{1,5}$/.test(retry) && Number(retry) <= 86400 ? Number(retry) : undefined
  return new RemoteBackendError(
    'http', response.status, validProblem ? code : undefined,
    validProblem && typeof problem.request_id === 'string' && UUID.test(problem.request_id) ? problem.request_id : undefined,
    retrySeconds,
  )
}

export function isRemoteNoteNotFound(error: unknown): boolean {
  return error instanceof RemoteBackendError && error.kind === 'http' && error.status === 404 && error.problemCode === 'not-found'
}

export function remoteProjection<T>(project: () => T): T {
  try { return project() } catch (error) {
    if (error instanceof RemoteBackendError) throw error
    throw new RemoteBackendError('invalid-response')
  }
}
