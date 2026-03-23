/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

const API_PREFIX = '/api/v1/'
const MCP_PREFIX = '/mcp/'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only intercept our API and MCP paths on same origin
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith(API_PREFIX) || url.pathname.startsWith(MCP_PREFIX)) {
    event.respondWith(handleRequest(event.request, url))
  }
})

async function handleRequest(request: Request, url: URL): Promise<Response> {
  // For now, return a stub JSON response indicating the SW is active
  // Real handlers will be added in C2 issues
  if (url.pathname.startsWith(MCP_PREFIX)) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Not implemented' },
      }),
      {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  if (url.pathname.startsWith(API_PREFIX)) {
    return new Response(
      JSON.stringify({
        error: 'Not implemented',
        path: url.pathname,
      }),
      {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  return fetch(request)
}
