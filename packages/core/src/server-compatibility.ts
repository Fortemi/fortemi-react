export const FORTEMI_COMPATIBILITY_PATH = '/api/v1/system/compatibility'
export const FORTEMI_SERVER_COMPATIBILITY_REVISION = '2026-07-06'

export const FORTEMI_COMPATIBILITY_STATES = [
  'available',
  'degraded',
  'preview',
  'unavailable',
  'unknown',
] as const

export type FortemiCompatibilityState = (typeof FORTEMI_COMPATIBILITY_STATES)[number]

export const FORTEMI_REQUIRED_COMPATIBILITY_CAPABILITIES = [
  'core_notes',
  'search',
  'jobs',
  'realtime_activity',
  'hosted_auth',
  'premium_components',
  'backoffice_api',
  'audit_posture',
  'quota_status',
  'kms_status',
  'mcp_scope_gate',
] as const

export type FortemiRequiredCompatibilityCapability =
  (typeof FORTEMI_REQUIRED_COMPATIBILITY_CAPABILITIES)[number]

export interface FortemiCompatibilityCapability {
  state: FortemiCompatibilityState
  reason_code?: string
}

export interface FortemiCompatibilityResponse {
  schema_version: number
  contract_revision: string
  api: {
    name: string
    version: string
    minimum_hotm_enterprise_client: string
    git_sha_present: boolean
    build_date_present: boolean
  }
  deployment: {
    mode: string
    edition: string
    hosted_multi_tenant_ready: boolean
  }
  auth: {
    required: boolean
    mode: string
    oauth_issuer_configured: boolean
    tenant_context_available: boolean
  }
  capabilities: Record<string, FortemiCompatibilityCapability>
  links: {
    openapi: string
    asyncapi: string
    health: string
    streaming_health: string
  }
}

export interface FortemiCompatibilityValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  response?: FortemiCompatibilityResponse
}

export interface FetchFortemiCompatibilityOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSupportedState(value: unknown): value is FortemiCompatibilityState {
  return typeof value === 'string' && FORTEMI_COMPATIBILITY_STATES.includes(value as FortemiCompatibilityState)
}

function requireRecord(parent: Record<string, unknown>, key: string, errors: string[]): Record<string, unknown> | null {
  const value = parent[key]
  if (!isRecord(value)) {
    errors.push(`${key} must be an object`)
    return null
  }
  return value
}

function requireString(parent: Record<string, unknown>, key: string, path: string, errors: string[]): string | null {
  const value = parent[key]
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path}.${key} must be a non-empty string`)
    return null
  }
  return value
}

function requireBoolean(parent: Record<string, unknown>, key: string, path: string, errors: string[]): boolean | null {
  const value = parent[key]
  if (typeof value !== 'boolean') {
    errors.push(`${path}.${key} must be a boolean`)
    return null
  }
  return value
}

export function fortemiCompatibilityUrl(baseUrl = 'http://localhost:3000'): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith(FORTEMI_COMPATIBILITY_PATH)) return trimmed
  return `${trimmed}${FORTEMI_COMPATIBILITY_PATH}`
}

export function validateFortemiCompatibilityResponse(raw: unknown): FortemiCompatibilityValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: ['response must be a JSON object'],
      warnings,
    }
  }

  if (raw.schema_version !== 1) {
    errors.push('schema_version must be 1')
  }
  requireString(raw, 'contract_revision', 'response', errors)

  const api = requireRecord(raw, 'api', errors)
  if (api) {
    const name = requireString(api, 'name', 'api', errors)
    if (name && name !== 'fortemi') {
      errors.push('api.name must be fortemi')
    }
    requireString(api, 'version', 'api', errors)
    requireString(api, 'minimum_hotm_enterprise_client', 'api', errors)
    requireBoolean(api, 'git_sha_present', 'api', errors)
    requireBoolean(api, 'build_date_present', 'api', errors)
  }

  const deployment = requireRecord(raw, 'deployment', errors)
  if (deployment) {
    requireString(deployment, 'mode', 'deployment', errors)
    requireString(deployment, 'edition', 'deployment', errors)
    requireBoolean(deployment, 'hosted_multi_tenant_ready', 'deployment', errors)
  }

  const auth = requireRecord(raw, 'auth', errors)
  if (auth) {
    requireBoolean(auth, 'required', 'auth', errors)
    requireString(auth, 'mode', 'auth', errors)
    requireBoolean(auth, 'oauth_issuer_configured', 'auth', errors)
    requireBoolean(auth, 'tenant_context_available', 'auth', errors)
  }

  const capabilities = requireRecord(raw, 'capabilities', errors)
  if (capabilities) {
    for (const key of FORTEMI_REQUIRED_COMPATIBILITY_CAPABILITIES) {
      if (!isRecord(capabilities[key])) {
        errors.push(`capabilities.${key} must be present as an object`)
      }
    }

    for (const [key, value] of Object.entries(capabilities)) {
      if (!isRecord(value)) {
        errors.push(`capabilities.${key} must be an object`)
        continue
      }
      if (!isSupportedState(value.state)) {
        errors.push(`capabilities.${key}.state must be one of ${FORTEMI_COMPATIBILITY_STATES.join(', ')}`)
      }
      if ('reason_code' in value && typeof value.reason_code !== 'string') {
        errors.push(`capabilities.${key}.reason_code must be a string when present`)
      }
      if (value.state !== 'available' && !value.reason_code) {
        warnings.push(`capabilities.${key} is ${String(value.state)} without reason_code`)
      }
    }
  }

  const links = requireRecord(raw, 'links', errors)
  if (links) {
    requireString(links, 'openapi', 'links', errors)
    requireString(links, 'asyncapi', 'links', errors)
    requireString(links, 'health', 'links', errors)
    requireString(links, 'streaming_health', 'links', errors)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    response: errors.length === 0 ? raw as unknown as FortemiCompatibilityResponse : undefined,
  }
}

export function formatFortemiCompatibilitySummary(response: FortemiCompatibilityResponse): string {
  const capabilitySummary = Object.entries(response.capabilities)
    .map(([key, value]) => `${key}=${value.state}`)
    .sort()
    .join(', ')

  return [
    `Fortemi compatibility ${response.contract_revision}`,
    `api=${response.api.name}@${response.api.version}`,
    `deployment=${response.deployment.mode}/${response.deployment.edition}`,
    `auth=${response.auth.mode}`,
    `capabilities: ${capabilitySummary}`,
  ].join('\n')
}

export async function fetchAndValidateFortemiCompatibility(
  options: FetchFortemiCompatibilityOptions = {}
): Promise<FortemiCompatibilityValidationResult & { url: string; status?: number }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) {
    return {
      ok: false,
      url: fortemiCompatibilityUrl(options.baseUrl),
      errors: ['fetch is not available in this runtime'],
      warnings: [],
    }
  }

  const url = fortemiCompatibilityUrl(options.baseUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000)

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const status = response.status
    const contentType = response.headers.get('content-type') ?? ''

    if (!response.ok) {
      return {
        ok: false,
        url,
        status,
        errors: [`Fortemi compatibility endpoint returned HTTP ${status}`],
        warnings: [],
      }
    }

    if (!contentType.toLowerCase().includes('application/json')) {
      return {
        ok: false,
        url,
        status,
        errors: [`Fortemi compatibility endpoint must return JSON; got ${contentType || 'unknown content-type'}`],
        warnings: [],
      }
    }

    return {
      ...validateFortemiCompatibilityResponse(await response.json()),
      url,
      status,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      url,
      errors: [`Fortemi compatibility endpoint is unreachable: ${message}`],
      warnings: [],
    }
  } finally {
    clearTimeout(timeout)
  }
}
