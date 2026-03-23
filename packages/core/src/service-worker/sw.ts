/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { createRoutes, matchRoute } from './routes.js'

const API_PREFIX = '/api/v1/'
const MCP_PREFIX = '/mcp/'

const routes = createRoutes()

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
    const route = matchRoute(routes, request, url)
    if (route) {
      const match = url.pathname.match(route.pattern)!
      return route.handler(request, match, url.searchParams)
    }

    return new Response(
      JSON.stringify({
        error: 'Not found',
        path: url.pathname,
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  return fetch(request)
}
