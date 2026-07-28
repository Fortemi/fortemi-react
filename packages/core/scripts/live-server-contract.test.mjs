import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import {
  COMPATIBILITY_PATH,
  SHARD_EXPORT_PATH,
  runLiveServerContract,
  sealLiveServerReceipt,
  verifyLiveServerContractReceipt,
} from './live-server-contract.mjs'

const components = Array.from({ length: 33 }, (_, index) => `component-${index + 1}`)
const counts = Object.fromEntries(
  Array.from({ length: 34 }, (_, index) => [`count_${index + 1}`, index]),
)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function fakeEnvironment({ contractRevision = '21' } = {}) {
  const archives = new Map()
  let nextArchiveId = 1
  const registerArchive = (files) => {
    const id = nextArchiveId
    nextArchiveId += 1
    archives.set(id, new Map(files))
    return Uint8Array.of(id)
  }
  const unpackTarGz = (bytes) => new Map(archives.get(bytes[0]))
  const packTarGz = (files) => registerArchive(files)
  const manifest = {
    version: '2.0.0',
    profile: 'full-v1',
    producer: { name: 'fortemi', version: '2026.7.28' },
    components,
    counts,
    min_reader_version: '2.0.0',
  }
  const sourceArchive = registerArchive(
    new Map([['manifest.json', encoder.encode(JSON.stringify(manifest))]]),
  )

  const database = {
    snapshots: 0,
    files: 0,
    component_records: 0,
    blob_references: 0,
  }
  const db = {
    async query() {
      return { rows: [{ ...database }] }
    },
    async close() {},
  }
  class MigrationRunner {
    async apply() {}
  }
  class MemoryBlobStore {
    async reconcile() {
      return { referenced: 0, missing: [], unreferenced: [], removed: 0, bytesFreed: 0 }
    }

    async close() {}
  }

  const core = {
    async fetchAndValidateFortemiCompatibility({ baseUrl, fetchImpl }) {
      const response = await fetchImpl(`${baseUrl}${COMPATIBILITY_PATH}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      })
      const body = await response.json()
      return {
        ok: body.schema_version === 1 && body.api.name === 'fortemi',
        errors: [],
        warnings: [],
        response: body,
        status: response.status,
      }
    },
    async validateFullV1ShardArchive(archive) {
      const files = unpackTarGz(archive)
      const parsed = JSON.parse(decoder.decode(files.get('manifest.json')))
      return {
        valid: parsed.version === '2.0.0' && parsed.profile === 'full-v1',
        errors: [],
      }
    },
    unpackTarGz,
    packTarGz,
    async createPGliteInstance() {
      return db
    },
    MigrationRunner,
    allMigrations: [],
    MemoryBlobStore,
    async importShard(_db, archive) {
      const parsed = JSON.parse(
        decoder.decode(unpackTarGz(archive).get('manifest.json')),
      )
      if (parsed.version === '3.0.0') {
        return {
          success: false,
          errors: ['unsupported exact authority tuple'],
          component_counts: {},
        }
      }
      database.snapshots = 1
      database.files = archives.get(archive[0]).size
      database.component_records = 33
      return { success: true, errors: [], component_counts: counts }
    },
    async exportShardWithReport() {
      return { success: true, archive: sourceArchive, errors: [] }
    },
  }

  const requests = []
  const compatibility = {
    schema_version: 1,
    contract_revision: contractRevision,
    api: {
      name: 'fortemi',
      version: '2026.7.28',
      minimum_hotm_enterprise_client: '2026.7.1',
      git_sha_present: true,
      build_date_present: true,
    },
    deployment: {
      mode: 'self-hosted',
      edition: 'community',
      hosted_multi_tenant_ready: false,
    },
    auth: {
      required: true,
      mode: 'bearer',
      oauth_issuer_configured: false,
      tenant_context_available: false,
    },
    capabilities: {},
    links: {
      openapi: '/api-docs/openapi.json',
      asyncapi: '/api-docs/asyncapi.json',
      health: '/health',
      streaming_health: '/health/streaming',
    },
  }
  const fetchImpl = async (input, init) => {
    const url = String(input)
    const headers = new globalThis.Headers(init?.headers)
    requests.push({ url, authorization: headers.get('authorization') })
    if (url.endsWith(COMPATIBILITY_PATH)) {
      return new globalThis.Response(JSON.stringify(compatibility), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes(SHARD_EXPORT_PATH)) {
      return new globalThis.Response(sourceArchive, { status: 200 })
    }
    return new globalThis.Response(null, { status: 404 })
  }
  return { core, fetchImpl, requests }
}

test('runs an authenticated live server export through a clean core consumer', async () => {
  const environment = fakeEnvironment()
  const times = [
    new Date('2026-07-28T12:00:00.000Z'),
    new Date('2026-07-28T12:00:01.000Z'),
  ]
  const receipt = await runLiveServerContract({
    serverUrl: 'https://fortemi.example',
    token: 'top-secret',
    fetchImpl: environment.fetchImpl,
    loadCore: async () => environment.core,
    now: () => times.shift(),
  })

  assert.equal(verifyLiveServerContractReceipt(receipt).status, 'passed')
  assert.equal(receipt.coreConsumer.cleanDestination.satisfied, true)
  assert.equal(receipt.coreConsumer.rejection.zeroMutation, true)
  assert.equal(receipt.coreConsumer.reexport.logicalFilesExact, true)
  assert.deepEqual(
    environment.requests.map((request) => request.authorization),
    ['Bearer top-secret', 'Bearer top-secret'],
  )
  assert.equal(JSON.stringify(receipt).includes('top-secret'), false)
})

test('rejects missing credentials, invalid origins, and tampered live evidence', async () => {
  const environment = fakeEnvironment()
  await assert.rejects(
    runLiveServerContract({
      serverUrl: 'https://fortemi.example',
      fetchImpl: environment.fetchImpl,
      loadCore: async () => environment.core,
    }),
    /server token is required/,
  )
  await assert.rejects(
    runLiveServerContract({
      serverUrl: 'https://fortemi.example/api',
      token: 'secret',
      fetchImpl: environment.fetchImpl,
      loadCore: async () => environment.core,
    }),
    /must be an origin/,
  )

  const times = [
    new Date('2026-07-28T12:00:00.000Z'),
    new Date('2026-07-28T12:00:01.000Z'),
  ]
  const receipt = await runLiveServerContract({
    serverUrl: 'https://fortemi.example',
    token: 'secret',
    fetchImpl: environment.fetchImpl,
    loadCore: async () => environment.core,
    now: () => times.shift(),
  })
  receipt.coreConsumer.reexport.logicalFilesExact = false
  assert.throws(
    () => verifyLiveServerContractReceipt(sealLiveServerReceipt(receipt)),
    /re-export evidence is incomplete/,
  )
})

test('rejects a revision 20 live server before fetching its parseable archive', async () => {
  const environment = fakeEnvironment({ contractRevision: '20' })
  await assert.rejects(
    runLiveServerContract({
      serverUrl: 'https://fortemi.example',
      token: 'secret',
      fetchImpl: environment.fetchImpl,
      loadCore: async () => environment.core,
    }),
    /contract revision must be 21; got 20/,
  )
  assert.deepEqual(
    environment.requests.map((request) => request.url),
    [`https://fortemi.example${COMPATIBILITY_PATH}`],
  )
})

test('uses the real core PGlite consumer against an authenticated HTTP server', async () => {
  const archive = readFileSync(new URL(
    '../src/__tests__/shard/fixtures/full-v1/server-full-v1-revision-19-v2.shard',
    import.meta.url,
  ))
  const requiredCapabilities = [
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
  ]
  const realCompatibility = {
    schema_version: 1,
    contract_revision: '21',
    api: {
      name: 'fortemi',
      version: '2026.7.28',
      minimum_hotm_enterprise_client: '2026.7.1',
      git_sha_present: true,
      build_date_present: true,
    },
    deployment: {
      mode: 'self-hosted',
      edition: 'community',
      hosted_multi_tenant_ready: false,
    },
    auth: {
      required: true,
      mode: 'oauth-bearer',
      oauth_issuer_configured: true,
      tenant_context_available: true,
    },
    capabilities: Object.fromEntries(
      requiredCapabilities.map((capability) => [capability, { state: 'available' }]),
    ),
    links: {
      openapi: '/api-docs/openapi.json',
      asyncapi: '/api-docs/asyncapi.json',
      health: '/health',
      streaming_health: '/health/streaming',
    },
  }
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer integration-token') {
      response.writeHead(401).end()
      return
    }
    if (request.url === COMPATIBILITY_PATH) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(realCompatibility))
      return
    }
    if (request.url?.startsWith(SHARD_EXPORT_PATH)) {
      response.writeHead(200, { 'content-type': 'application/gzip' })
      response.end(archive)
      return
    }
    response.writeHead(404).end()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const receipt = await runLiveServerContract({
      serverUrl: `http://127.0.0.1:${address.port}`,
      token: 'integration-token',
    })
    assert.equal(verifyLiveServerContractReceipt(receipt).status, 'passed')
    assert.equal(receipt.server.compatibility.contractRevision, '21')
    assert.equal(receipt.coreConsumer.import.databaseAfter.snapshots, 1)
    assert.equal(receipt.coreConsumer.reexport.logicalFilesExact, true)
  } finally {
    server.close()
    await once(server, 'close')
  }
})
