import { createHash } from 'node:crypto'

export const LIVE_RECEIPT_SCHEMA = 'fortemi.live-server-core-contract-receipt.v1'
export const LIVE_COMMAND_ID = 'fortemi-react.live-server-core.v1'
export const COMPATIBILITY_PATH = '/api/v1/system/compatibility'
export const SHARD_EXPORT_PATH = '/api/v1/backup/knowledge-shard'
export const SHARD_EXPORT_QUERY =
  'schema_version=2.0.0&profile=full-v1&include_blobs=true'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  )
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value))
}

function assertLive(condition, message) {
  if (!condition) throw new Error(`Live Fortemi contract gate failed: ${message}`)
}

function normalizedServerOrigin(serverUrl) {
  assertLive(typeof serverUrl === 'string' && serverUrl.trim() !== '', 'server URL is required')
  const url = new URL(serverUrl)
  assertLive(
    url.protocol === 'http:' || url.protocol === 'https:',
    'server URL must use http or https',
  )
  if (url.protocol === 'http:') {
    assertLive(
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
      'plaintext HTTP is restricted to loopback servers',
    )
  }
  assertLive(url.username === '' && url.password === '', 'server URL must not contain credentials')
  assertLive(
    url.pathname === '/' && url.search === '' && url.hash === '',
    'server URL must be an origin without a path, query, or fragment',
  )
  return url.origin
}

function authenticatedFetch(fetchImpl, token) {
  assertLive(typeof token === 'string' && token.trim() !== '', 'server token is required')
  return (input, init = {}) => {
    const headers = new globalThis.Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    return fetchImpl(input, { ...init, headers })
  }
}

async function fetchArchive(fetchImpl, url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/gzip, application/octet-stream' },
      signal: controller.signal,
    })
    assertLive(response.ok, `GET ${SHARD_EXPORT_PATH} returned HTTP ${response.status}`)
    const archive = new Uint8Array(await response.arrayBuffer())
    assertLive(archive.byteLength > 0, `GET ${SHARD_EXPORT_PATH} returned an empty body`)
    return { archive, status: response.status }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Live Fortemi contract gate failed:')) {
      throw error
    }
    throw new Error(
      `Live Fortemi contract gate failed: GET ${SHARD_EXPORT_PATH} was unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function manifestFromFiles(files) {
  const bytes = files.get('manifest.json')
  assertLive(bytes, 'export archive is missing manifest.json')
  let manifest
  try {
    manifest = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new Error('Live Fortemi contract gate failed: export manifest is not valid JSON')
  }
  assertLive(manifest.version === '2.0.0', 'export manifest version is not 2.0.0')
  assertLive(manifest.profile === 'full-v1', 'export manifest profile is not full-v1')
  assertLive(
    Array.isArray(manifest.components) && manifest.components.length === 33,
    'export manifest does not declare all 33 full-v1 components',
  )
  assertLive(
    manifest.counts
      && typeof manifest.counts === 'object'
      && Object.keys(manifest.counts).length === 34,
    'export manifest does not declare all 34 full-v1 count fields',
  )
  assertLive(
    Object.values(manifest.counts).every(
      (count) => Number.isInteger(count) && count > 0,
    ),
    'export manifest must contain a nonempty authority fixture in every full-v1 component',
  )
  return manifest
}

function fileDigestMap(files) {
  return Object.fromEntries(
    [...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => [path, sha256(bytes)]),
  )
}

async function destinationSnapshot(db) {
  const result = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM knowledge_shard_snapshot) AS snapshots,
      (SELECT COUNT(*)::int FROM knowledge_shard_file) AS files,
      (SELECT COUNT(*)::int FROM knowledge_shard_component_record) AS component_records,
      (SELECT COUNT(*)::int FROM knowledge_shard_blob_reference) AS blob_references
  `)
  const row = result.rows[0] ?? {}
  return {
    snapshots: Number(row.snapshots ?? 0),
    files: Number(row.files ?? 0),
    componentRecords: Number(row.component_records ?? 0),
    blobReferences: Number(row.blob_references ?? 0),
  }
}

async function blobSnapshot(blobStore) {
  const result = await blobStore.reconcile([])
  return {
    referenced: result.referenced,
    missing: result.missing,
    stored: result.unreferenced.length,
  }
}

function nextMajorArchive(files, packTarGz) {
  const rejectedFiles = new Map(files)
  const manifest = JSON.parse(decoder.decode(rejectedFiles.get('manifest.json')))
  manifest.version = '3.0.0'
  manifest.min_reader_version = '3.0.0'
  rejectedFiles.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))
  rejectedFiles.delete('signature.json')
  return packTarGz(rejectedFiles)
}

async function defaultLoadCore() {
  return import('../dist/index.js')
}

export function sealLiveServerReceipt(receipt) {
  const unsigned = { ...receipt }
  delete unsigned.receiptDigest
  return {
    ...unsigned,
    receiptDigest: {
      algorithm: 'sha256(canonical JSON without receiptDigest)',
      value: sha256(canonicalJson(unsigned)),
    },
  }
}

export async function runLiveServerContract({
  serverUrl,
  token,
  fetchImpl = globalThis.fetch,
  loadCore = defaultLoadCore,
  timeoutMs = 30_000,
  now = () => new Date(),
} = {}) {
  assertLive(typeof fetchImpl === 'function', 'fetch is unavailable')
  const origin = normalizedServerOrigin(serverUrl)
  const fetchWithToken = authenticatedFetch(fetchImpl, token)
  const core = await loadCore()
  const startedAt = now().toISOString()

  const compatibility = await core.fetchAndValidateFortemiCompatibility({
    baseUrl: origin,
    fetchImpl: fetchWithToken,
    timeoutMs,
  })
  assertLive(
    compatibility.ok && compatibility.response,
    `compatibility validation failed: ${compatibility.errors.join('; ')}`,
  )
  assertLive(
    compatibility.response.contract_revision === '21',
    `compatibility contract revision must be 21; got ${compatibility.response.contract_revision}`,
  )
  assertLive(
    compatibility.response.auth.required === true,
    'compatibility endpoint must advertise required authentication',
  )

  const exportUrl = `${origin}${SHARD_EXPORT_PATH}?${SHARD_EXPORT_QUERY}`
  const downloaded = await fetchArchive(fetchWithToken, exportUrl, timeoutMs)
  const validation = await core.validateFullV1ShardArchive(downloaded.archive)
  assertLive(
    validation.valid,
    `server export failed full-v1 validation: ${validation.errors.join('; ')}`,
  )
  const sourceFiles = core.unpackTarGz(downloaded.archive)
  const manifest = manifestFromFiles(sourceFiles)
  const sourceFileDigests = fileDigestMap(sourceFiles)

  const db = await core.createPGliteInstance('memory', 'platform-live-contract')
  const blobStore = new core.MemoryBlobStore()
  try {
    await new core.MigrationRunner(db).apply(core.allMigrations)
    const cleanDatabase = await destinationSnapshot(db)
    const cleanBlobs = await blobSnapshot(blobStore)
    assertLive(
      Object.values(cleanDatabase).every((count) => count === 0) && cleanBlobs.stored === 0,
      'core destination is not clean before import',
    )

    const rejected = await core.importShard(
      db,
      nextMajorArchive(sourceFiles, core.packTarGz),
      { conflictStrategy: 'replace', blobStore },
    )
    assertLive(rejected.success === false, 'next-major archive was not rejected')
    assertLive(
      rejected.errors.some(
        (error) => /3\.0\.0\/full-v1|exact 2\.0\.0\/full-v1 authority tuple/i.test(error),
      ),
      `next-major rejection reason was not version-specific: ${rejected.errors.join('; ')}`,
    )
    const databaseAfterRejection = await destinationSnapshot(db)
    const blobsAfterRejection = await blobSnapshot(blobStore)
    assertLive(
      canonicalJson(databaseAfterRejection) === canonicalJson(cleanDatabase)
        && canonicalJson(blobsAfterRejection) === canonicalJson(cleanBlobs),
      'next-major rejection mutated the clean destination',
    )

    const imported = await core.importShard(db, downloaded.archive, {
      conflictStrategy: 'replace',
      blobStore,
    })
    assertLive(imported.success, `core import failed: ${imported.errors.join('; ')}`)
    const databaseAfterImport = await destinationSnapshot(db)
    assertLive(databaseAfterImport.snapshots === 1, 'core import did not persist one snapshot')

    const reexported = await core.exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore,
    })
    assertLive(
      reexported.success && reexported.archive,
      `core re-export failed: ${reexported.errors.join('; ')}`,
    )
    const reexportValidation = await core.validateFullV1ShardArchive(reexported.archive)
    assertLive(
      reexportValidation.valid,
      `core re-export failed full-v1 validation: ${reexportValidation.errors.join('; ')}`,
    )
    const returnedFiles = core.unpackTarGz(reexported.archive)
    const returnedFileDigests = fileDigestMap(returnedFiles)
    assertLive(
      canonicalJson(returnedFileDigests) === canonicalJson(sourceFileDigests),
      'core re-export did not reproduce the live server logical files',
    )

    const completedAt = now().toISOString()
    return sealLiveServerReceipt({
      schemaVersion: LIVE_RECEIPT_SCHEMA,
      status: 'passed',
      command: {
        id: LIVE_COMMAND_ID,
        compatibility: `GET ${COMPATIBILITY_PATH}`,
        serverExport: `GET ${SHARD_EXPORT_PATH}?${SHARD_EXPORT_QUERY}`,
        coreConsumer:
          '@fortemi/core importShard -> clean migrated in-memory PGlite -> exportShardWithReport',
      },
      server: {
        origin,
        authentication: {
          scheme: 'bearer',
          tokenProvided: true,
          tokenRecorded: false,
        },
        compatibility: {
          path: COMPATIBILITY_PATH,
          httpStatus: compatibility.status,
          validated: true,
          schemaVersion: compatibility.response.schema_version,
          contractRevision: compatibility.response.contract_revision,
          apiName: compatibility.response.api.name,
          apiVersion: compatibility.response.api.version,
          authRequired: compatibility.response.auth.required,
        },
        export: {
          path: SHARD_EXPORT_PATH,
          query: SHARD_EXPORT_QUERY,
          httpStatus: downloaded.status,
          bytes: downloaded.archive.byteLength,
          sha256: sha256(downloaded.archive),
          logicalFileSetSha256: sha256(canonicalJson(sourceFileDigests)),
          logicalFileCount: Object.keys(sourceFileDigests).length,
          manifest: {
            version: manifest.version,
            profile: manifest.profile,
            producer: manifest.producer,
            componentCount: manifest.components.length,
            countFieldCount: Object.keys(manifest.counts).length,
            nonemptyCountFieldCount: Object.values(manifest.counts)
              .filter((count) => Number.isInteger(count) && count > 0).length,
            minimumCount: Math.min(...Object.values(manifest.counts)),
          },
        },
      },
      coreConsumer: {
        backend: 'pglite-memory',
        tuple: {
          schemaVersion: '2.0.0',
          profile: 'full-v1',
        },
        cleanDestination: {
          satisfied: true,
          database: cleanDatabase,
          blobs: cleanBlobs,
        },
        rejection: {
          case: 'next-major-3.0.0',
          rejected: true,
          errors: rejected.errors,
          versionReasonBound: true,
          databaseAfter: databaseAfterRejection,
          blobsAfter: blobsAfterRejection,
          zeroMutation: true,
        },
        import: {
          success: true,
          databaseAfter: databaseAfterImport,
          componentCounts: imported.component_counts,
        },
        reexport: {
          success: true,
          validated: true,
          logicalFilesExact: true,
          logicalFileSetSha256: sha256(canonicalJson(returnedFileDigests)),
          logicalFileCount: Object.keys(returnedFileDigests).length,
        },
      },
      dataPlanes: {
        knowledgeShard: 'live-fortemi-server-to-react-core',
        aiwgStaticIndex: false,
        aiwgToShardBridge: false,
      },
      claims: {
        exactTupleOnly: true,
        liveServerToCore: true,
        cleanDestination: true,
        zeroMutationOnRejection: true,
        completeBackup: false,
        suiteWide: false,
        persistencePlanesUnified: false,
      },
      run: {
        startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      },
    })
  } finally {
    await Promise.allSettled([blobStore.close(), db.close()])
  }
}

function assertSame(actual, expected, label) {
  assertLive(canonicalJson(actual) === canonicalJson(expected), `${label} drifted`)
}

export function verifyLiveServerContractReceipt(receipt) {
  assertLive(receipt?.schemaVersion === LIVE_RECEIPT_SCHEMA, 'unsupported receipt schema')
  assertLive(receipt.status === 'passed', 'receipt status is not passed')
  assertLive(receipt.command?.id === LIVE_COMMAND_ID, 'command identity drifted')
  assertLive(receipt.command.compatibility === `GET ${COMPATIBILITY_PATH}`, 'compatibility command drifted')
  assertLive(
    receipt.command.serverExport === `GET ${SHARD_EXPORT_PATH}?${SHARD_EXPORT_QUERY}`,
    'server export command drifted',
  )
  normalizedServerOrigin(receipt.server?.origin)
  assertSame(
    receipt.server.authentication,
    { scheme: 'bearer', tokenProvided: true, tokenRecorded: false },
    'authentication evidence',
  )
  assertLive(
    receipt.server.compatibility?.path === COMPATIBILITY_PATH
      && receipt.server.compatibility.httpStatus === 200
      && receipt.server.compatibility.validated === true
      && receipt.server.compatibility.schemaVersion === 1
      && receipt.server.compatibility.contractRevision === '21'
      && receipt.server.compatibility.apiName === 'fortemi'
      && receipt.server.compatibility.authRequired === true,
    'compatibility evidence is incomplete',
  )
  assertLive(
    receipt.server.export?.path === SHARD_EXPORT_PATH
      && receipt.server.export.query === SHARD_EXPORT_QUERY
      && receipt.server.export.httpStatus === 200
      && Number.isInteger(receipt.server.export.bytes)
      && receipt.server.export.bytes > 0
      && /^[0-9a-f]{64}$/.test(receipt.server.export.sha256)
      && /^[0-9a-f]{64}$/.test(receipt.server.export.logicalFileSetSha256)
      && receipt.server.export.manifest?.version === '2.0.0'
      && receipt.server.export.manifest.profile === 'full-v1'
      && receipt.server.export.manifest.componentCount === 33
      && receipt.server.export.manifest.countFieldCount === 34
      && receipt.server.export.manifest.nonemptyCountFieldCount === 34
      && receipt.server.export.manifest.minimumCount >= 1,
    'live full-v1 export evidence is incomplete',
  )
  assertLive(
    receipt.coreConsumer?.backend === 'pglite-memory'
      && receipt.coreConsumer.tuple?.schemaVersion === '2.0.0'
      && receipt.coreConsumer.tuple.profile === 'full-v1',
    'core consumer tuple drifted',
  )
  assertLive(
    receipt.coreConsumer.cleanDestination?.satisfied === true
      && Object.values(receipt.coreConsumer.cleanDestination.database)
        .every((count) => count === 0)
      && receipt.coreConsumer.cleanDestination.blobs.stored === 0,
    'clean-destination evidence is incomplete',
  )
  assertLive(
    receipt.coreConsumer.rejection?.case === 'next-major-3.0.0'
      && receipt.coreConsumer.rejection.rejected === true
      && receipt.coreConsumer.rejection.versionReasonBound === true
      && receipt.coreConsumer.rejection.zeroMutation === true
      && Array.isArray(receipt.coreConsumer.rejection.errors)
      && receipt.coreConsumer.rejection.errors.length > 0,
    'rejection evidence is incomplete',
  )
  assertSame(
    receipt.coreConsumer.rejection.databaseAfter,
    receipt.coreConsumer.cleanDestination.database,
    'database rejection state',
  )
  assertSame(
    receipt.coreConsumer.rejection.blobsAfter,
    receipt.coreConsumer.cleanDestination.blobs,
    'blob rejection state',
  )
  assertLive(
    receipt.coreConsumer.import?.success === true
      && receipt.coreConsumer.import.databaseAfter?.snapshots === 1,
    'core import evidence is incomplete',
  )
  assertLive(
    receipt.coreConsumer.reexport?.success === true
      && receipt.coreConsumer.reexport.validated === true
      && receipt.coreConsumer.reexport.logicalFilesExact === true
      && receipt.coreConsumer.reexport.logicalFileSetSha256
        === receipt.server.export.logicalFileSetSha256
      && receipt.coreConsumer.reexport.logicalFileCount
        === receipt.server.export.logicalFileCount,
    'core re-export evidence is incomplete',
  )
  assertSame(
    receipt.dataPlanes,
    {
      knowledgeShard: 'live-fortemi-server-to-react-core',
      aiwgStaticIndex: false,
      aiwgToShardBridge: false,
    },
    'data-plane boundary',
  )
  assertLive(
    receipt.claims?.exactTupleOnly === true
      && receipt.claims.liveServerToCore === true
      && receipt.claims.cleanDestination === true
      && receipt.claims.zeroMutationOnRejection === true
      && receipt.claims.completeBackup === false
      && receipt.claims.suiteWide === false
      && receipt.claims.persistencePlanesUnified === false,
    'claim boundary is invalid',
  )
  const startedAt = Date.parse(receipt.run?.startedAt)
  const completedAt = Date.parse(receipt.run?.completedAt)
  assertLive(
    Number.isFinite(startedAt)
      && Number.isFinite(completedAt)
      && completedAt >= startedAt
      && receipt.run.durationMs === completedAt - startedAt,
    'run timing is invalid',
  )
  assertSame(
    receipt.receiptDigest,
    sealLiveServerReceipt(receipt).receiptDigest,
    'receipt digest',
  )
  return receipt
}
