
export type CspDirectiveName =
  | 'default-src'
  | 'base-uri'
  | 'object-src'
  | 'frame-ancestors'
  | 'img-src'
  | 'font-src'
  | 'style-src'
  | 'script-src'
  | 'connect-src'
  | 'worker-src'
  | 'manifest-src'
  | 'report-uri'

export type CspDirectives = Partial<Record<CspDirectiveName, string[]>>

export interface PluginCspOptions {
  scriptSrc?: string[]
  connectSrc?: string[]
  imgSrc?: string[]
  styleSrc?: string[]
  reportUri?: string
  extraDirectives?: CspDirectives
}

export interface PluginScriptPolicy {
  allowedOrigins: string[]
  allowedUrls?: string[]
  requireSri?: boolean
}

export interface PluginScriptDescriptor {
  url: string
  integrity?: string
  crossOrigin?: 'anonymous' | 'use-credentials'
}

export interface LoadedPluginScript {
  url: string
  integrity: string
  bytes: Uint8Array
  text: string
}

export interface CspViolationReport {
  documentUri?: string
  violatedDirective?: string
  effectiveDirective?: string
  blockedUri?: string
  originalPolicy?: string
  disposition?: string
  sourceFile?: string
  lineNumber?: number
  columnNumber?: number
  raw: unknown
}

const DEFAULT_DIRECTIVES: CspDirectives = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'script-src': ["'self'", "'strict-dynamic'"],
  'connect-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
}

const SUPPORTED_SRI_ALGORITHMS = new Set(['sha256', 'sha384', 'sha512'])

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function mergeDirective(base: string[] | undefined, additions: string[] | undefined): string[] | undefined {
  if (!base && !additions) return undefined
  return unique([...(base ?? []), ...(additions ?? [])])
}

export function buildPluginCsp(options: PluginCspOptions = {}): string {
  const directives: CspDirectives = { ...DEFAULT_DIRECTIVES }
  directives['script-src'] = mergeDirective(directives['script-src'], options.scriptSrc)
  directives['connect-src'] = mergeDirective(directives['connect-src'], options.connectSrc)
  directives['img-src'] = mergeDirective(directives['img-src'], options.imgSrc)
  directives['style-src'] = mergeDirective(directives['style-src'], options.styleSrc)

  if (options.reportUri) {
    directives['report-uri'] = [options.reportUri]
  }

  for (const [name, values] of Object.entries(options.extraDirectives ?? {}) as Array<[CspDirectiveName, string[]]>) {
    directives[name] = mergeDirective(directives[name], values)
  }

  return Object.entries(directives)
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0)
    .map(([name, values]) => name + ' ' + values.join(' '))
    .join('; ')
}

function parseSriToken(integrity: string): { algorithm: string; digest: string } {
  const token = integrity.trim().split(/\s+/)[0]
  const separator = token.indexOf('-')
  if (separator <= 0) throw new Error('Invalid SRI token')

  const algorithm = token.slice(0, separator).toLowerCase()
  const digest = token.slice(separator + 1)
  if (!SUPPORTED_SRI_ALGORITHMS.has(algorithm)) {
    throw new Error('Unsupported SRI algorithm: ' + algorithm)
  }
  if (!digest) throw new Error('Invalid SRI digest')
  return { algorithm, digest }
}

function toBase64(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes)
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function toArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

export async function computeSri(data: Uint8Array | ArrayBuffer, algorithm = 'sha384'): Promise<string> {
  const normalized = algorithm.toLowerCase()
  if (!SUPPORTED_SRI_ALGORITHMS.has(normalized)) {
    throw new Error('Unsupported SRI algorithm: ' + algorithm)
  }
  const digest = await crypto.subtle.digest(normalized.toUpperCase().replace('SHA', 'SHA-'), toArrayBuffer(data))
  return normalized + '-' + toBase64(digest)
}

export async function verifySri(data: Uint8Array | ArrayBuffer, integrity: string): Promise<boolean> {
  const expected = parseSriToken(integrity)
  return (await computeSri(data, expected.algorithm)) === expected.algorithm + '-' + expected.digest
}

export function isPluginScriptAllowed(url: string, policy: PluginScriptPolicy): boolean {
  let parsed: URL
  try {
    parsed = new URL(url, globalThis.location?.href)
  } catch {
    return false
  }

  const exactAllowed = policy.allowedUrls?.some(allowed => new URL(allowed, parsed.href).href === parsed.href) ?? false
  if (exactAllowed) return true

  return policy.allowedOrigins.some(origin => {
    if (origin === '*') return true
    return new URL(origin, parsed.href).origin === parsed.origin
  })
}

export async function fetchPluginScript(
  descriptor: PluginScriptDescriptor,
  policy: PluginScriptPolicy,
  fetchFn: typeof fetch = fetch,
): Promise<LoadedPluginScript> {
  if (!isPluginScriptAllowed(descriptor.url, policy)) {
    throw new Error('Plugin script origin is not allowlisted: ' + descriptor.url)
  }
  if (policy.requireSri !== false && !descriptor.integrity) {
    throw new Error('Plugin script requires an SRI integrity value: ' + descriptor.url)
  }

  const response = await fetchFn(descriptor.url, {
    credentials: descriptor.crossOrigin === 'use-credentials' ? 'include' : 'omit',
  })
  if (!response.ok) {
    throw new Error('Plugin script fetch failed with HTTP ' + response.status + ': ' + descriptor.url)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (descriptor.integrity && !(await verifySri(bytes, descriptor.integrity))) {
    throw new Error('Plugin script failed SRI verification: ' + descriptor.url)
  }

  return {
    url: descriptor.url,
    integrity: descriptor.integrity ?? await computeSri(bytes),
    bytes,
    text: new TextDecoder().decode(bytes),
  }
}

export async function appendPluginScript(
  descriptor: PluginScriptDescriptor,
  policy: PluginScriptPolicy,
  doc: Document = document,
): Promise<HTMLScriptElement> {
  if (!isPluginScriptAllowed(descriptor.url, policy)) {
    throw new Error('Plugin script origin is not allowlisted: ' + descriptor.url)
  }
  if (policy.requireSri !== false && !descriptor.integrity) {
    throw new Error('Plugin script requires an SRI integrity value: ' + descriptor.url)
  }

  const script = doc.createElement('script')
  script.type = 'module'
  script.src = descriptor.url
  if (descriptor.integrity) script.integrity = descriptor.integrity
  script.crossOrigin = descriptor.crossOrigin ?? 'anonymous'

  await new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Plugin script failed to load: ' + descriptor.url)), { once: true })
    doc.head.appendChild(script)
  })

  return script
}

export function parseCspReport(body: unknown): CspViolationReport {
  const report = typeof body === 'object' && body !== null && 'csp-report' in body
    ? (body as { 'csp-report': Record<string, unknown> })['csp-report']
    : typeof body === 'object' && body !== null && 'body' in body
      ? (body as { body: Record<string, unknown> }).body
      : body

  const r = report as Record<string, unknown>
  return {
    documentUri: typeof r['document-uri'] === 'string' ? r['document-uri'] : undefined,
    violatedDirective: typeof r['violated-directive'] === 'string' ? r['violated-directive'] : undefined,
    effectiveDirective: typeof r['effective-directive'] === 'string' ? r['effective-directive'] : undefined,
    blockedUri: typeof r['blocked-uri'] === 'string' ? r['blocked-uri'] : undefined,
    originalPolicy: typeof r['original-policy'] === 'string' ? r['original-policy'] : undefined,
    disposition: typeof r.disposition === 'string' ? r.disposition : undefined,
    sourceFile: typeof r['source-file'] === 'string' ? r['source-file'] : undefined,
    lineNumber: typeof r['line-number'] === 'number' ? r['line-number'] : undefined,
    columnNumber: typeof r['column-number'] === 'number' ? r['column-number'] : undefined,
    raw: body,
  }
}

export function createCspReportHandler(
  onReport: (report: CspViolationReport) => void | Promise<void>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    }

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid CSP report JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await onReport(parseCspReport(json))
    return new Response(null, { status: 204 })
  }
}
