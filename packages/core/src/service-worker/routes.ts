/**
 * REST route definitions for Service Worker.
 * These are pure functions that transform HTTP Request → tool input and tool output → Response.
 * The actual DB connection is injected at registration time.
 *
 * All routes currently return 503 Not Implemented — the DB wiring happens in a later issue.
 * The URL structure and request/response shapes are the valuable contract defined here.
 */

export interface RouteHandler {
  method: string
  pattern: RegExp
  handler: (request: Request, match: RegExpMatchArray, params: URLSearchParams) => Promise<Response>
}

/** Parse JSON body safely — returns null when the body is absent or malformed */
async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/** Create a JSON response */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Create an error response */
function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status)
}

const DB_NOT_CONNECTED = 'Database not connected. REST API available in standalone mode only.'

/**
 * Create route handlers.
 * db parameter will be injected when the SW gets access to PGlite.
 * For now, returns 503 Not Implemented for all routes.
 */
export function createRoutes(): RouteHandler[] {
  return [
    // GET /api/v1/notes — list notes
    {
      method: 'GET',
      pattern: /^\/api\/v1\/notes\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // POST /api/v1/notes — create note
    {
      method: 'POST',
      pattern: /^\/api\/v1\/notes\/?$/,
      handler: async (request) => {
        const body = await parseJsonBody(request)
        if (body === null) return errorResponse('Invalid JSON body', 400)
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // POST /api/v1/notes/:id/restore — restore soft-deleted note (must come before /:id)
    {
      method: 'POST',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/restore\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // POST /api/v1/notes/:id/star — star or unstar a note
    {
      method: 'POST',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/star\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // POST /api/v1/notes/:id/archive — archive or unarchive a note
    {
      method: 'POST',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/archive\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // GET /api/v1/notes/:id — get a single note
    {
      method: 'GET',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // PUT /api/v1/notes/:id — update a note
    {
      method: 'PUT',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // DELETE /api/v1/notes/:id — soft-delete a note
    {
      method: 'DELETE',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },

    // GET /api/v1/search — full-text search
    {
      method: 'GET',
      pattern: /^\/api\/v1\/search\/?$/,
      handler: async () => {
        return errorResponse(DB_NOT_CONNECTED, 503)
      },
    },
  ]
}

/**
 * Match a request against the registered routes and return the first matching
 * handler, or null if no route matches.
 */
export function matchRoute(routes: RouteHandler[], request: Request, url: URL): RouteHandler | null {
  for (const route of routes) {
    if (request.method !== route.method) continue
    const match = url.pathname.match(route.pattern)
    if (match) return route
  }
  return null
}
