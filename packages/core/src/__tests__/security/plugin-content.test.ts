
import { describe, it, expect, vi } from 'vitest'
import {
  buildPluginCsp,
  computeSri,
  createCspReportHandler,
  fetchPluginScript,
  isPluginScriptAllowed,
  parseCspReport,
  verifySri,
} from '../../security/plugin-content.js'

const encoder = new TextEncoder()

describe('plugin content security', () => {
  it('builds a locked-down default CSP with strict-dynamic', () => {
    const csp = buildPluginCsp({ reportUri: '/api/csp-report' })

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("script-src 'self' 'strict-dynamic'")
    expect(csp).toContain('report-uri /api/csp-report')
  })

  it('adds allowlisted script and connect origins to CSP', () => {
    const csp = buildPluginCsp({
      scriptSrc: ['https://plugins.example.test'],
      connectSrc: ['https://api.example.test'],
    })

    expect(csp).toContain("script-src 'self' 'strict-dynamic' https://plugins.example.test")
    expect(csp).toContain("connect-src 'self' https://api.example.test")
  })

  it('matches exact script URLs and origins against the plugin allowlist', () => {
    const policy = {
      allowedOrigins: ['https://plugins.example.test'],
      allowedUrls: ['https://static.example.test/plugin-a.js'],
    }

    expect(isPluginScriptAllowed('https://plugins.example.test/plugin.js', policy)).toBe(true)
    expect(isPluginScriptAllowed('https://static.example.test/plugin-a.js', policy)).toBe(true)
    expect(isPluginScriptAllowed('https://evil.example.test/plugin.js', policy)).toBe(false)
  })

  it('computes and verifies SRI digests', async () => {
    const bytes = encoder.encode('export const ok = true')
    const sri = await computeSri(bytes, 'sha256')

    expect(sri).toMatch(/^sha256-/)
    await expect(verifySri(bytes, sri)).resolves.toBe(true)
    await expect(verifySri(encoder.encode('tampered'), sri)).resolves.toBe(false)
  })

  it('loads a plugin script when allowlist and SRI both pass', async () => {
    const bytes = encoder.encode('export const plugin = true')
    const integrity = await computeSri(bytes)
    const fetchFn = vi.fn().mockResolvedValue(new Response(bytes))

    const loaded = await fetchPluginScript(
      { url: 'https://plugins.example.test/plugin.js', integrity },
      { allowedOrigins: ['https://plugins.example.test'] },
      fetchFn,
    )

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(loaded.text).toBe('export const plugin = true')
    expect(loaded.integrity).toBe(integrity)
  })

  it('rejects a plugin script when SRI does not match', async () => {
    const good = encoder.encode('export const plugin = true')
    const tampered = encoder.encode('export const plugin = false')
    const integrity = await computeSri(good)
    const fetchFn = vi.fn().mockResolvedValue(new Response(tampered))

    await expect(fetchPluginScript(
      { url: 'https://plugins.example.test/plugin.js', integrity },
      { allowedOrigins: ['https://plugins.example.test'] },
      fetchFn,
    )).rejects.toThrow('failed SRI verification')
  })

  it('requires SRI by default for allowlisted scripts', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('export {}'))

    await expect(fetchPluginScript(
      { url: 'https://plugins.example.test/plugin.js' },
      { allowedOrigins: ['https://plugins.example.test'] },
      fetchFn,
    )).rejects.toThrow('requires an SRI integrity value')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('parses CSP violation reports from report-uri payloads', () => {
    const report = parseCspReport({
      'csp-report': {
        'document-uri': 'https://app.example.test/',
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example.test/plugin.js',
        disposition: 'report',
      },
    })

    expect(report.documentUri).toBe('https://app.example.test/')
    expect(report.violatedDirective).toBe('script-src')
    expect(report.blockedUri).toBe('https://evil.example.test/plugin.js')
    expect(report.disposition).toBe('report')
  })

  it('creates a CSP report-only endpoint handler', async () => {
    const onReport = vi.fn()
    const handler = createCspReportHandler(onReport)
    const response = await handler(new Request('https://app.example.test/api/csp-report', {
      method: 'POST',
      body: JSON.stringify({ 'csp-report': { 'blocked-uri': 'inline' } }),
    }))

    expect(response.status).toBe(204)
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ blockedUri: 'inline' }))
  })
})
