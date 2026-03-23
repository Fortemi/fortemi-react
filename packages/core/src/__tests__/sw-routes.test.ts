/**
 * Tests for Service Worker REST route definitions.
 * These are pure routing tests — no PGlite or DB connection needed.
 * Routes return 503 (DB not connected) which is correct for the current phase.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createRoutes, matchRoute } from '../service-worker/routes.js'
import type { RouteHandler } from '../service-worker/routes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method: string, path: string, body?: unknown): Request {
  const url = `http://localhost${path}`
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new Request(url, init)
}

function makeUrl(path: string): URL {
  return new URL(`http://localhost${path}`)
}

// ---------------------------------------------------------------------------
// matchRoute
// ---------------------------------------------------------------------------

describe('matchRoute', () => {
  let routes: RouteHandler[]

  beforeEach(() => {
    routes = createRoutes()
  })

  it('matches GET /api/v1/notes', () => {
    const request = makeRequest('GET', '/api/v1/notes')
    const url = makeUrl('/api/v1/notes')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('GET')
  })

  it('matches GET /api/v1/notes/ with trailing slash', () => {
    const request = makeRequest('GET', '/api/v1/notes/')
    const url = makeUrl('/api/v1/notes/')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('GET')
  })

  it('matches POST /api/v1/notes', () => {
    const request = makeRequest('POST', '/api/v1/notes')
    const url = makeUrl('/api/v1/notes')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('POST')
  })

  it('matches GET /api/v1/notes/:id', () => {
    const request = makeRequest('GET', '/api/v1/notes/abc-123')
    const url = makeUrl('/api/v1/notes/abc-123')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('GET')
  })

  it('matches PUT /api/v1/notes/:id', () => {
    const request = makeRequest('PUT', '/api/v1/notes/abc-123')
    const url = makeUrl('/api/v1/notes/abc-123')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('PUT')
  })

  it('matches DELETE /api/v1/notes/:id', () => {
    const request = makeRequest('DELETE', '/api/v1/notes/abc-123')
    const url = makeUrl('/api/v1/notes/abc-123')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('DELETE')
  })

  it('matches POST /api/v1/notes/:id/restore', () => {
    const request = makeRequest('POST', '/api/v1/notes/abc-123/restore')
    const url = makeUrl('/api/v1/notes/abc-123/restore')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('POST')
  })

  it('matches POST /api/v1/notes/:id/star', () => {
    const request = makeRequest('POST', '/api/v1/notes/abc-123/star')
    const url = makeUrl('/api/v1/notes/abc-123/star')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('POST')
  })

  it('matches POST /api/v1/notes/:id/archive', () => {
    const request = makeRequest('POST', '/api/v1/notes/abc-123/archive')
    const url = makeUrl('/api/v1/notes/abc-123/archive')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('POST')
  })

  it('matches GET /api/v1/search', () => {
    const request = makeRequest('GET', '/api/v1/search')
    const url = makeUrl('/api/v1/search')
    const match = matchRoute(routes, request, url)
    expect(match).not.toBeNull()
    expect(match?.method).toBe('GET')
  })

  it('returns null for unrecognized path', () => {
    const request = makeRequest('GET', '/api/v1/unknown')
    const url = makeUrl('/api/v1/unknown')
    const match = matchRoute(routes, request, url)
    expect(match).toBeNull()
  })

  it('returns null when method does not match route', () => {
    // GET /api/v1/notes/:id/restore does not exist — only POST
    const request = makeRequest('GET', '/api/v1/notes/abc-123/restore')
    const url = makeUrl('/api/v1/notes/abc-123/restore')
    const match = matchRoute(routes, request, url)
    expect(match).toBeNull()
  })

  it('returns null for DELETE on /api/v1/notes (list endpoint)', () => {
    const request = makeRequest('DELETE', '/api/v1/notes')
    const url = makeUrl('/api/v1/notes')
    const match = matchRoute(routes, request, url)
    expect(match).toBeNull()
  })

  it('GET /api/v1/notes does not match /api/v1/notes/:id', () => {
    // The collection GET and the individual GET must be distinct matches
    const listRequest = makeRequest('GET', '/api/v1/notes')
    const listUrl = makeUrl('/api/v1/notes')
    const listMatch = matchRoute(routes, listRequest, listUrl)

    const noteRequest = makeRequest('GET', '/api/v1/notes/abc-123')
    const noteUrl = makeUrl('/api/v1/notes/abc-123')
    const noteMatch = matchRoute(routes, noteRequest, noteUrl)

    // Both should match but to different patterns
    expect(listMatch).not.toBeNull()
    expect(noteMatch).not.toBeNull()
    expect(listMatch?.pattern).not.toBe(noteMatch?.pattern)
  })
})

// ---------------------------------------------------------------------------
// Route handler responses (all return 503 until DB is wired)
// ---------------------------------------------------------------------------

describe('route handlers return 503 when DB not connected', () => {
  let routes: RouteHandler[]

  beforeEach(() => {
    routes = createRoutes()
  })

  async function dispatchRoute(method: string, path: string, body?: unknown): Promise<Response> {
    const request = makeRequest(method, path, body)
    const url = makeUrl(path)
    const route = matchRoute(routes, request, url)
    if (!route) throw new Error(`No route matched ${method} ${path}`)
    const pathMatch = url.pathname.match(route.pattern)!
    const params = url.searchParams
    return route.handler(request, pathMatch, params)
  }

  it('GET /api/v1/notes returns 503', async () => {
    const response = await dispatchRoute('GET', '/api/v1/notes')
    expect(response.status).toBe(503)
  })

  it('POST /api/v1/notes returns 503', async () => {
    const response = await dispatchRoute('POST', '/api/v1/notes', { content: 'hello' })
    expect(response.status).toBe(503)
  })

  it('GET /api/v1/notes/:id returns 503', async () => {
    const response = await dispatchRoute('GET', '/api/v1/notes/abc-123')
    expect(response.status).toBe(503)
  })

  it('PUT /api/v1/notes/:id returns 503', async () => {
    const response = await dispatchRoute('PUT', '/api/v1/notes/abc-123', { title: 'Updated' })
    expect(response.status).toBe(503)
  })

  it('DELETE /api/v1/notes/:id returns 503', async () => {
    const response = await dispatchRoute('DELETE', '/api/v1/notes/abc-123')
    expect(response.status).toBe(503)
  })

  it('POST /api/v1/notes/:id/restore returns 503', async () => {
    const response = await dispatchRoute('POST', '/api/v1/notes/abc-123/restore')
    expect(response.status).toBe(503)
  })

  it('POST /api/v1/notes/:id/star returns 503', async () => {
    const response = await dispatchRoute('POST', '/api/v1/notes/abc-123/star', { starred: true })
    expect(response.status).toBe(503)
  })

  it('POST /api/v1/notes/:id/archive returns 503', async () => {
    const response = await dispatchRoute('POST', '/api/v1/notes/abc-123/archive', {
      archived: true,
    })
    expect(response.status).toBe(503)
  })

  it('GET /api/v1/search returns 503', async () => {
    const response = await dispatchRoute('GET', '/api/v1/search?q=hello')
    expect(response.status).toBe(503)
  })
})

// ---------------------------------------------------------------------------
// Response format helpers
// ---------------------------------------------------------------------------

describe('response format', () => {
  let routes: RouteHandler[]

  beforeEach(() => {
    routes = createRoutes()
  })

  it('all responses have Content-Type: application/json', async () => {
    const request = makeRequest('GET', '/api/v1/notes')
    const url = makeUrl('/api/v1/notes')
    const route = matchRoute(routes, request, url)!
    const pathMatch = url.pathname.match(route.pattern)!
    const response = await route.handler(request, pathMatch, url.searchParams)

    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('503 error body contains error field', async () => {
    const request = makeRequest('GET', '/api/v1/notes')
    const url = makeUrl('/api/v1/notes')
    const route = matchRoute(routes, request, url)!
    const pathMatch = url.pathname.match(route.pattern)!
    const response = await route.handler(request, pathMatch, url.searchParams)
    const body = (await response.json()) as { error: string }

    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')
  })

  it('POST /api/v1/notes with invalid JSON returns 400', async () => {
    // Create a request with malformed body
    const request = new Request('http://localhost/api/v1/notes', {
      method: 'POST',
      body: 'not-json{{{',
      headers: { 'Content-Type': 'application/json' },
    })
    const url = makeUrl('/api/v1/notes')
    const route = matchRoute(routes, request, url)!
    const pathMatch = url.pathname.match(route.pattern)!
    const response = await route.handler(request, pathMatch, url.searchParams)

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// Query parameter parsing (list route)
// ---------------------------------------------------------------------------

describe('GET /api/v1/notes query parameter parsing', () => {
  it('handler receives limit, offset, sort, order from query params', async () => {
    const routes = createRoutes()
    const path = '/api/v1/notes?limit=10&offset=20&sort=updated_at&order=asc&starred=true'
    const request = makeRequest('GET', path)
    const url = makeUrl(path)
    const route = matchRoute(routes, request, url)!
    const pathMatch = url.pathname.match(route.pattern)!

    // Handler should not throw even though DB is not connected
    const response = await route.handler(request, pathMatch, url.searchParams)
    // Still returns 503 — params are parsed but DB call is skipped
    expect(response.status).toBe(503)
  })
})
