import { describe, expect, it } from 'vitest'
import {
  FORTEMI_REQUIRED_COMPATIBILITY_CAPABILITIES,
  fetchAndValidateFortemiCompatibility,
  fortemiCompatibilityUrl,
  formatFortemiCompatibilitySummary,
  validateFortemiCompatibilityResponse,
} from '../server-compatibility.js'

function compatibilityFixture(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    contract_revision: '2026-07-06',
    api: {
      name: 'fortemi',
      version: '2026.7.0',
      minimum_hotm_enterprise_client: '0.0.0-checkpoint',
      git_sha_present: true,
      build_date_present: true,
    },
    deployment: {
      mode: 'local_sidecar',
      edition: 'community',
      hosted_multi_tenant_ready: false,
    },
    auth: {
      required: false,
      mode: 'anonymous_local',
      oauth_issuer_configured: false,
      tenant_context_available: false,
    },
    capabilities: {
      core_notes: { state: 'available' },
      search: { state: 'available' },
      jobs: { state: 'available' },
      realtime_activity: { state: 'available' },
      hosted_auth: { state: 'unavailable', reason_code: 'hosted_auth_not_configured' },
      premium_components: { state: 'preview', reason_code: 'capability_catalog_preview_only' },
      backoffice_api: { state: 'unavailable', reason_code: 'contract_not_implemented' },
      audit_posture: { state: 'preview', reason_code: 'hosted_audit_gate_open' },
      quota_status: { state: 'unavailable', reason_code: 'quota_policy_not_implemented' },
      kms_status: { state: 'unavailable', reason_code: 'key_provider_not_implemented' },
      mcp_scope_gate: { state: 'preview', reason_code: 'enterprise_gate_not_implemented' },
    },
    links: {
      openapi: '/openapi.yaml',
      asyncapi: '/asyncapi.yaml',
      health: '/health',
      streaming_health: '/api/v1/health/streaming',
    },
    ...overrides,
  }
}

describe('Fortemi server compatibility validation', () => {
  it('accepts the current local-sidecar compatibility response shape', () => {
    const result = validateFortemiCompatibilityResponse(compatibilityFixture())

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.response?.deployment.mode).toBe('local_sidecar')
    expect(formatFortemiCompatibilitySummary(result.response!)).toContain('backoffice_api=unavailable')
  })

  it('preserves degraded capability states as supported metadata', () => {
    const result = validateFortemiCompatibilityResponse(compatibilityFixture({
      capabilities: {
        ...compatibilityFixture().capabilities,
        realtime_activity: { state: 'degraded', reason_code: 'streaming_health_degraded' },
      },
    }))

    expect(result.ok).toBe(true)
    expect(result.response?.capabilities.realtime_activity).toEqual({
      state: 'degraded',
      reason_code: 'streaming_health_degraded',
    })
  })

  it('fails closed when required capability keys are missing', () => {
    const capabilities: Record<string, unknown> = { ...compatibilityFixture().capabilities }
    delete capabilities.kms_status

    const result = validateFortemiCompatibilityResponse(compatibilityFixture({ capabilities }))

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('capabilities.kms_status must be present as an object')
  })

  it('fails closed on unknown future capability states', () => {
    const result = validateFortemiCompatibilityResponse(compatibilityFixture({
      capabilities: {
        ...compatibilityFixture().capabilities,
        premium_components: { state: 'experimental' },
      },
    }))

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'capabilities.premium_components.state must be one of available, degraded, preview, unavailable, unknown'
    )
  })

  it('builds the compatibility URL from a base URL or full endpoint URL', () => {
    expect(fortemiCompatibilityUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/api/v1/system/compatibility'
    )
    expect(fortemiCompatibilityUrl('http://localhost:3000/api/v1/system/compatibility')).toBe(
      'http://localhost:3000/api/v1/system/compatibility'
    )
  })

  it('fetches and validates JSON from a local server endpoint', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(compatibilityFixture()), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })

    const result = await fetchAndValidateFortemiCompatibility({
      baseUrl: 'http://localhost:3000',
      fetchImpl,
    })

    expect(result.ok).toBe(true)
    expect(result.url).toBe('http://localhost:3000/api/v1/system/compatibility')
    expect(result.status).toBe(200)
  })

  it('reports unreachable local server checks without throwing', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('connection refused')
    }

    const result = await fetchAndValidateFortemiCompatibility({
      baseUrl: 'http://127.0.0.1:9',
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('unreachable')
  })

  it('keeps the required capability list aligned with the public contract', () => {
    expect(FORTEMI_REQUIRED_COMPATIBILITY_CAPABILITIES).toEqual([
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
    ])
  })
})
