import type { DatabaseClient } from '../storage-backend.js'
import type {
  ImportCounts,
  ImportOptions,
  ImportResult,
  ShardComponent,
  ShardExportResult,
  ShardManifest,
} from './types.js'
import { unpackTarGz, packTarGz } from './shard-tar.js'
import { parseJsonArrayBytes, parseJsonlBytes } from './parse.js'
import { collectSidecarBlobs, SIDECAR_PREFIX } from './blob-sidecar.js'
import { promoteBlobs } from './blob-staging.js'
import { computeBlobHash } from '../hash.js'
import { verifyShardSignature } from './shard-signature.js'
import { validateFullV1ShardArchive, FULL_V1_COMPONENT_FILES } from './schema-validator.js'
import { createShardCapabilityReport } from './profile-registry.js'
import { sha256Hex } from './checksum.js'
import { componentPresenceLosses, presenceLosses } from './presence.js'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function emptyCounts(): ImportCounts {
  return {
    notes: 0, collections: 0, templates: 0, tags: 0, links: 0,
    embedding_sets: 0, embedding_configs: 0, embedding_set_members: 0, embeddings: 0,
    skos_schemes: 0, skos_concepts: 0, skos_relations: 0, note_skos_tags: 0,
    provenance_edges: 0, graph_sources: 0, graph_edges: 0, community_sets: 0,
    communities: 0, community_assignments: 0,
  }
}

function recordKey(component: ShardComponent, record: Record<string, unknown>, ordinal: number): string {
  if (typeof record.id === 'string') return record.id
  const identityFields = [
    'embedding_set_id', 'note_id', 'graph_source_id', 'from_note_id', 'to_note_id',
    'community_set_id', 'community_id', 'scheme_id', 'concept_id', 'collection_id',
    'member_id', 'source_concept_id', 'target_concept_id', 'kind', 'relation_type',
  ]
  const parts = identityFields
    .filter((field) => record[field] !== undefined)
    .map((field) => `${field}=${JSON.stringify(record[field])}`)
  return parts.length > 0 ? `${component}:${parts.join('|')}` : `${component}:ordinal:${ordinal}`
}

function componentRecords(
  component: ShardComponent,
  bytes: Uint8Array | undefined,
): Array<Record<string, unknown>> {
  const spec = FULL_V1_COMPONENT_FILES[component]
  const parsed = spec.encoding === 'json-array'
    ? parseJsonArrayBytes<Record<string, unknown>>(bytes)
    : parseJsonlBytes<Record<string, unknown>>(bytes)
  return parsed
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function encodeComponentRecords(
  component: ShardComponent,
  records: Array<Record<string, unknown>>,
): Uint8Array {
  return encoder.encode(FULL_V1_COMPONENT_FILES[component].encoding === 'json-array'
    ? JSON.stringify(records)
    : records.map((record) => JSON.stringify(record)).join('\n'))
}

function attachmentBlobReferences(files: Map<string, Uint8Array>): Map<string, number> {
  const refs = new Map<string, number>()
  for (const note of componentRecords('notes', files.get('notes.jsonl'))) {
    const attachments = Array.isArray(note.attachments) ? note.attachments : []
    for (const projection of attachments) {
      const checksum = (projection as { attachment?: { checksum?: unknown } }).attachment?.checksum
      if (typeof checksum === 'string') refs.set(checksum, (refs.get(checksum) ?? 0) + 1)
    }
  }
  return refs
}

async function signatureError(
  files: Map<string, Uint8Array>,
  options: ImportOptions | undefined,
): Promise<string | null> {
  const policy = options?.verifySignature ?? (options?.trustStore ? 'require' : undefined)
  if (!policy || policy === 'trusted-local-only') return null
  if (!options?.trustStore) return `verifySignature: '${policy}' requires a trustStore`
  const verdict = await verifyShardSignature({ files, trustStore: options.trustStore })
  if (verdict.ok || (verdict.reason === 'unsigned' && policy === 'prefer')) return null
  return `Full-v1 publisher verification failed: ${verdict.reason}`
}

export async function importFullV1Snapshot(
  db: DatabaseClient,
  data: Uint8Array | ArrayBuffer,
  options?: ImportOptions,
): Promise<ImportResult> {
  const started = performance.now()
  const counts = emptyCounts()
  let capability = createShardCapabilityReport({
    backend: 'pglite', operation: 'import', requestedProfile: 'full-v1',
    requestedSchemaVersion: '2.0.0',
  })
  const files = unpackTarGz(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
  const archiveSha256 = await sha256Hex(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json'))) as ShardManifest
  if (manifest.version !== '2.0.0' || manifest.profile !== 'full-v1') {
    return {
      success: false, counts, skipped: {}, warnings: [],
      errors: ['Complete PGlite persistence requires the exact 2.0.0/full-v1 authority tuple.'],
      duration_ms: performance.now() - started, capability_report: capability,
    }
  }
  const runtimeLosses = presenceLosses(
    'full-v1', 'manifest', manifest as unknown as Record<string, unknown>,
  )
  for (const component of manifest.components) {
    try {
      runtimeLosses.push(...componentPresenceLosses(
        'full-v1', component, componentRecords(component, files.get(FULL_V1_COMPONENT_FILES[component].file)),
      ))
    } catch {
      // Structural validation below owns parse diagnostics.
    }
  }
  capability = { ...capability, losses: runtimeLosses }
  const validation = await validateFullV1ShardArchive(files)
  if (!validation.valid) {
    return {
      success: false, counts, skipped: {}, warnings: [],
      errors: [`Canonical full-v1 validation failed: ${validation.errors.join('; ')}`],
      duration_ms: performance.now() - started, capability_report: capability,
    }
  }
  const authError = await signatureError(files, options)
  if (authError) {
    return {
      success: false, counts, skipped: {}, warnings: [], errors: [authError],
      duration_ms: performance.now() - started, capability_report: capability,
    }
  }

  const blobRefs = attachmentBlobReferences(files)
  const sidecars = collectSidecarBlobs(files)
  if (blobRefs.size > 0 && !options?.blobStore) {
    return {
      success: false, counts, skipped: {}, warnings: [],
      errors: ['2.0.0/full-v1 requires a BlobStore so mandatory attachment bytes remain portable.'],
      duration_ms: performance.now() - started, capability_report: capability,
    }
  }
  const blobs = new Map<string, Uint8Array>()
  for (const [checksum] of blobRefs) {
    const bare = checksum.includes(':') ? checksum.slice(checksum.indexOf(':') + 1) : checksum
    const bytes = sidecars.get(bare)
    if (!bytes || computeBlobHash(bytes) !== checksum) {
      return {
        success: false, counts, skipped: {}, warnings: [],
        errors: [`Missing or invalid mandatory attachment bytes for ${checksum}.`],
        duration_ms: performance.now() - started, capability_report: capability,
      }
    }
    blobs.set(checksum, bytes)
  }

  const parsed = manifest.components.map((component) => ({
    component,
    records: componentRecords(component, files.get(FULL_V1_COMPONENT_FILES[component].file)),
  }))
  const existing = await db.query<{ archive_sha256: string }>(
    'SELECT archive_sha256 FROM knowledge_shard_snapshot WHERE schema_version = $1 AND profile = $2',
    [manifest.version, manifest.profile],
  )
  if (existing.rows.length > 0 && options?.conflictStrategy === 'error') {
    return {
      success: false, counts, skipped: {}, warnings: [], errors: ['full-v1 snapshot already exists'],
      duration_ms: performance.now() - started, capability_report: capability,
    }
  }
  if (existing.rows.length > 0 && (options?.conflictStrategy ?? 'skip') === 'skip') {
    if (existing.rows[0].archive_sha256 !== archiveSha256) {
      return {
        success: false, counts, skipped: {}, warnings: [],
        errors: ['A different full-v1 snapshot already exists for 2.0.0/full-v1; use conflictStrategy replace to change it.'],
        duration_ms: performance.now() - started, capability_report: capability,
      }
    }
    return {
      success: true, counts, skipped: {}, warnings: ['Identical authority tuple already persisted; no rows changed.'], errors: [],
      duration_ms: performance.now() - started, capability_report: capability,
      component_counts: manifest.counts,
    }
  }

  const promotion = await promoteBlobs(options?.blobStore, blobs)
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        'DELETE FROM knowledge_shard_snapshot WHERE schema_version = $1 AND profile = $2',
        [manifest.version, manifest.profile],
      )
      await tx.query(
        `INSERT INTO knowledge_shard_snapshot (schema_version, profile, archive_sha256, manifest_json)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [manifest.version, manifest.profile, archiveSha256, JSON.stringify(manifest)],
      )
      for (const [path, bytes] of files) {
        if (path.startsWith(SIDECAR_PREFIX)) continue
        await tx.query(
          `INSERT INTO knowledge_shard_file (schema_version, profile, path, bytes)
           VALUES ($1, $2, $3, $4)`,
          [manifest.version, manifest.profile, path, bytes],
        )
      }
      for (const { component, records } of parsed) {
        for (const [ordinal, record] of records.entries()) {
          await tx.query(
            `INSERT INTO knowledge_shard_component_record
               (schema_version, profile, component, ordinal, record_key, record_json)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [manifest.version, manifest.profile, component, ordinal, recordKey(component, record, ordinal), JSON.stringify(record)],
          )
        }
      }
      for (const [checksum, refCount] of blobRefs) {
        await tx.query(
          `INSERT INTO knowledge_shard_blob_reference
             (schema_version, profile, checksum, ref_count) VALUES ($1, $2, $3, $4)`,
          [manifest.version, manifest.profile, checksum, refCount],
        )
      }
    })
  } catch (error) {
    await promotion.rollback()
    return {
      success: false, counts, skipped: {}, warnings: [],
      errors: [`full-v1 transaction failed: ${error instanceof Error ? error.message : String(error)}`],
      duration_ms: performance.now() - started, capability_report: capability,
    }
  }

  return {
    success: true, counts, skipped: {}, warnings: [], errors: [],
    duration_ms: performance.now() - started, capability_report: capability,
    component_counts: manifest.counts,
  }
}

export async function exportFullV1Snapshot(
  db: DatabaseClient,
  blobStore: NonNullable<ImportOptions['blobStore']>,
): Promise<ShardExportResult> {
  const capability = createShardCapabilityReport({
    backend: 'pglite', operation: 'export', requestedProfile: 'full-v1',
    requestedSchemaVersion: '2.0.0',
  })
  const fileRows = await db.query<{ path: string; bytes: Uint8Array }>(
    `SELECT path, bytes FROM knowledge_shard_file
      WHERE schema_version = '2.0.0' AND profile = 'full-v1' ORDER BY path`,
  )
  if (fileRows.rows.length === 0) {
    return { success: false, archive: null, errors: ['No persisted 2.0.0/full-v1 snapshot.'], capability_report: capability }
  }
  const files: Map<string, Uint8Array> = new Map(
    fileRows.rows.map((row) => [row.path, new Uint8Array(row.bytes)]),
  )
  const snapshot = await db.query<{ manifest_json: ShardManifest }>(
    `SELECT manifest_json FROM knowledge_shard_snapshot
      WHERE schema_version = '2.0.0' AND profile = 'full-v1'`,
  )
  const persisted = await db.query<{
    component: ShardComponent
    ordinal: number
    record_json: Record<string, unknown>
  }>(
    `SELECT component, ordinal, record_json
       FROM knowledge_shard_component_record
      WHERE schema_version = '2.0.0' AND profile = 'full-v1'
      ORDER BY component, ordinal`,
  )
  const currentRecords = new Map<ShardComponent, Array<Record<string, unknown>>>()
  for (const component of Object.keys(FULL_V1_COMPONENT_FILES) as ShardComponent[]) {
    currentRecords.set(component, [])
  }
  for (const row of persisted.rows) currentRecords.get(row.component)?.push(row.record_json)

  const changed = [...currentRecords].some(([component, records]) => {
    const original = componentRecords(component, files.get(FULL_V1_COMPONENT_FILES[component].file))
    return canonicalJson(records) !== canonicalJson(original)
  })
  let blobRefs: Map<string, number>
  if (changed) {
    const manifest = structuredClone(snapshot.rows[0].manifest_json)
    const checksums: Record<string, string> = {}
    for (const [component, records] of currentRecords) {
      const spec = FULL_V1_COMPONENT_FILES[component]
      const bytes = encodeComponentRecords(component, records)
      files.set(spec.file, bytes)
      manifest.counts[component] = records.length
      checksums[spec.file] = await sha256Hex(bytes)
    }
    manifest.checksums = checksums
    manifest.created_at = new Date().toISOString()
    manifest.producer = {
      name: 'fortemi-react-full-v1-store',
      version: manifest.producer?.version ?? 'unknown',
    }
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))
    files.delete('signature.json')
    blobRefs = attachmentBlobReferences(files)
  } else {
    const refs = await db.query<{ checksum: string; ref_count: number }>(
      `SELECT checksum, ref_count FROM knowledge_shard_blob_reference
        WHERE schema_version = '2.0.0' AND profile = 'full-v1' ORDER BY checksum`,
    )
    blobRefs = new Map(refs.rows.map((row) => [row.checksum, Number(row.ref_count)]))
  }
  for (const checksum of blobRefs.keys()) {
    const bytes = await blobStore.read(checksum)
    if (!bytes || computeBlobHash(bytes) !== checksum) {
      return { success: false, archive: null, errors: [`BlobStore cannot reproduce ${checksum}.`], capability_report: capability }
    }
    const bare = checksum.includes(':') ? checksum.slice(checksum.indexOf(':') + 1) : checksum
    files.set(`${SIDECAR_PREFIX}${bare}`, new Uint8Array(bytes))
  }
  const validation = await validateFullV1ShardArchive(files)
  if (!validation.valid) {
    return { success: false, archive: null, errors: validation.errors, capability_report: capability }
  }
  return { success: true, archive: packTarGz(files), errors: [], capability_report: capability }
}
