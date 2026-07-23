/**
 * DB-free Knowledge Shard export/import over the canonical RecordStore
 * (#323 cycle 2, ADR-013 D3/D6) — the same `.shard` archive format as the
 * PGlite pipeline (`shard/shard-export.ts` / `shard/shard-import.ts`), built
 * from and applied to canonical records with zero PGlite.
 *
 * Capability boundary (reported, never emulated): the canonical tier holds
 * notes, tags, note-to-note links, collections, and attachment manifests.
 * Shard components outside that set (templates, embeddings, SKOS, provenance,
 * graph/community artifacts, URL links) are skipped on import with explicit
 * warnings, and are never emitted on export.
 *
 * Atomicity: manifest, version, signature (ADR-014 verify-before-persist),
 * and checksum validation all run before mutation. Verified sidecar bytes are
 * promoted with rollback, then every record and journal mutation commits in
 * one multi-collection RecordStore batch.
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @depends @packages/core/src/shard/schema-validator.ts
 * @created 2026-07-17
 * @agent Codex
 */

import type {
  RecordStore,
  RecordMutation,
  AttachmentRecord,
  NoteRecord0,
} from './types.js'
import { VERSION } from '../index.js'
import { packTarGz, unpackTarGz } from '../shard/shard-tar.js'
import { sha256Hex, validateChecksums } from '../shard/checksum.js'
import { sidecarEntryName, collectSidecarBlobs, blobChecksumToHex } from '../shard/blob-sidecar.js'
import { enforceSignaturePolicy } from '../shard/shard-import.js'
import {
  noteToShard,
  noteFromShard,
  linkToShard,
  linkFromShard,
  collectionToShard,
  collectionFromShard,
  tagsToShard,
} from '../shard/field-mapper.js'
import type { BrowserNoteExport } from '../shard/field-mapper.js'
import { generateId } from '../uuid.js'
import { computeHash, computeBlobHash } from '../hash.js'
import {
  compareShardVersions,
  CURRENT_SHARD_VERSION,
  MAX_SHARD_READER_VERSION,
  SHARD_FORMAT,
} from '../shard/types.js'
import type {
  ExportOptions,
  ImportOptions,
  ImportResult,
  ImportCounts,
  ShardManifest,
  ShardComponent,
  ShardClusterRef,
  ShardLayout,
  ShardNote,
  ShardLink,
  ShardCollection,
  ShardTag,
  ShardAttachmentProjection,
  ShardCapabilityReport,
  ShardExportResult,
  ShardLossEntry,
} from '../shard/types.js'
import { parseJsonArrayBytes, parseJsonlBytes } from '../shard/parse.js'
import {
  validateCoreV1ShardArchive,
  validateRecordV1ShardArchive,
} from '../shard/schema-validator.js'
import { promoteBlobs } from '../shard/blob-staging.js'
import { shouldApplyReplacement } from '../shard/convergence.js'
import {
  createShardCapabilityReport,
  profileSupportError,
} from '../shard/profile-registry.js'
import {
  capturePresence,
  componentPresenceLosses,
  presenceLosses,
  presencePointers,
  restoreStoredPresence,
} from '../shard/presence.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function emptyCounts(): ImportCounts {
  return {
    notes: 0,
    collections: 0,
    templates: 0,
    tags: 0,
    links: 0,
    embedding_sets: 0,
    embedding_configs: 0,
    embedding_set_members: 0,
    embeddings: 0,
    skos_schemes: 0,
    skos_concepts: 0,
    skos_relations: 0,
    note_skos_tags: 0,
    provenance_edges: 0,
    graph_sources: 0,
    graph_edges: 0,
    community_sets: 0,
    communities: 0,
    community_assignments: 0,
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function exportShardFromRecordsWithReport(
  store: RecordStore,
  options: ExportOptions & { profile: string },
): Promise<ShardExportResult> {
  let capabilityReport = createShardCapabilityReport({
    backend: 'record-store',
    operation: 'export',
    requestedProfile: options.profile,
    requestedSchemaVersion: options.schemaVersion ?? CURRENT_SHARD_VERSION,
  })
  const error = profileSupportError(capabilityReport)
  if (error) {
    return {
      success: false,
      archive: null,
      errors: [error],
      capability_report: capabilityReport,
    }
  }
  if (options.profile !== 'record-v1') {
    return {
      success: false,
      archive: null,
      errors: [
        `Knowledge Shard profile '${options.profile}' is not supported by the record-store export path`,
      ],
      capability_report: capabilityReport,
    }
  }

  const optionErrors = [
    ...(options.clusterNotesSize
      ? ['record-v1 does not declare clustered note files']
      : []),
    ...(options.includeBlobs
      ? ['record-v1 declares attachment references but not blob sidecar files']
      : []),
  ]
  if (optionErrors.length > 0) {
    return {
      success: false,
      archive: null,
      errors: optionErrors,
      capability_report: capabilityReport,
    }
  }

  try {
    const result = await buildRecordShardArchive(store, options, 'record-v1')
    capabilityReport = createShardCapabilityReport({
      backend: 'record-store',
      operation: 'export',
      requestedProfile: options.profile,
      requestedSchemaVersion: options.schemaVersion ?? CURRENT_SHARD_VERSION,
      declaredComponents: ['notes', 'collections', 'tags', 'links'],
      losses: result.losses,
    })
    const validation = await validateRecordV1ShardArchive(result.archive)
    if (!validation.valid) {
      return {
        success: false,
        archive: null,
        errors: [
          `Generated record-v1 archive failed self-validation: ${validation.errors.join('; ')}`,
        ],
        capability_report: capabilityReport,
      }
    }
    return {
      success: true,
      archive: result.archive,
      errors: [],
      capability_report: capabilityReport,
    }
  } catch (cause) {
    return {
      success: false,
      archive: null,
      errors: [cause instanceof Error ? cause.message : String(cause)],
      capability_report: capabilityReport,
    }
  }
}

/**
 * Export canonical records as a `.shard` archive (Uint8Array), format-parity
 * with the PGlite `exportShard`. Honored options: `collectionId` / `tag`
 * filters, `clusterNotesSize`, and the portable byte sidecar
 * (`includeBlobs` + `blobStore`). Embedding options are inert — the canonical
 * tier stores no embeddings, so there is nothing to include.
 */
export async function exportShardFromRecords(
  store: RecordStore,
  options?: ExportOptions,
): Promise<Uint8Array> {
  if (options?.profile) {
    throw new Error(
      'Named portability profiles require exportShardFromRecordsWithReport so capability and loss data cannot be discarded',
    )
  }
  return (await buildRecordShardArchive(store, options, null)).archive
}

interface RecordShardBuildResult {
  archive: Uint8Array
  losses: ShardLossEntry[]
}

async function buildRecordShardArchive(
  store: RecordStore,
  options: ExportOptions | undefined,
  profile: 'record-v1' | null,
): Promise<RecordShardBuildResult> {
  const files = new Map<string, Uint8Array>()
  const components: ShardComponent[] = []
  const counts: ShardManifest['counts'] = {}
  const losses: ShardLossEntry[] = []
  const isRecordV1 = profile === 'record-v1'
  const recordSchemaVersion = isRecordV1
    ? (options?.schemaVersion ?? CURRENT_SHARD_VERSION)
    : CURRENT_SHARD_VERSION

  const [allNotes, originals, revisedRows, tagRows, collections, memberships, attachments, blobs] =
    await Promise.all([
      store.list('note'),
      store.list('note_original'),
      store.list('note_revised_current'),
      store.list('note_tag'),
      store.list('collection'),
      store.list('collection_note'),
      store.list('attachment'),
      store.list('attachment_blob'),
    ])

  const originalByNote = new Map(originals.map((o) => [o.note_id, o]))
  const revisedByNote = new Map(revisedRows.map((r) => [r.id, r]))
  const blobById = new Map(blobs.map((b) => [b.id, b]))

  const tagsByNote = new Map<string, string[]>()
  for (const row of [...tagRows].sort((a, b) => a.tag.localeCompare(b.tag))) {
    const tags = tagsByNote.get(row.note_id) ?? []
    tags.push(row.tag)
    tagsByNote.set(row.note_id, tags)
  }

  // First collection membership per note (mirrors the SQL export's
  // `ORDER BY position, added_at LIMIT 1` — canonical memberships have no
  // position, so creation order decides).
  const collectionByNote = new Map<string, string>()
  for (const m of [...memberships].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!collectionByNote.has(m.note_id)) collectionByNote.set(m.note_id, m.collection_id)
  }

  const membershipNoteIds = new Map<string, Set<string>>()
  for (const m of memberships) {
    const set = membershipNoteIds.get(m.collection_id) ?? new Set<string>()
    set.add(m.note_id)
    membershipNoteIds.set(m.collection_id, set)
  }

  let notes = allNotes
  if (options?.collectionId) {
    const inCollection = membershipNoteIds.get(options.collectionId) ?? new Set<string>()
    notes = notes.filter((n) => inCollection.has(n.id))
  } else if (options?.tag) {
    notes = notes.filter((n) => tagsByNote.get(n.id)?.includes(options.tag!))
  }
  notes.sort((a, b) => a.created_at.localeCompare(b.created_at))

  const orderedAttachments = attachments
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
  const attachmentsByNote = new Map<string, ShardAttachmentProjection[]>()
  const exportedBlobChecksums: string[] = []
  for (const att of orderedAttachments) {
    const blob = blobById.get(att.blob_id)
    if (!blob) continue // manifest without a blob record cannot be projected
    const attachment = {
      // `path` is the display filename per the binary-attachment projection
      // contract — never a physical storage key.
      id: att.id,
      path: att.filename,
      mime: att.mime_type,
      checksum: blob.content_hash,
      bytes: blob.size_bytes,
    }
    const projection: ShardAttachmentProjection = isRecordV1
      ? {
          extracted_text: att.extracted_text,
          extraction_status: att.extracted_text === null ? 'deferred' : 'extracted',
          reason: att.extracted_text === null ? 'no_extracted_text' : null,
          attachment,
        }
      : {
          extracted_text: att.extracted_text,
          created_at: att.created_at,
          deleted_at: att.deleted_at,
          attachment,
        }
    const list = attachmentsByNote.get(att.note_id) ?? []
    list.push(projection)
    attachmentsByNote.set(att.note_id, list)
    exportedBlobChecksums.push(blob.content_hash)
  }

  const browserNotes: BrowserNoteExport[] = notes.map((n) => {
    const revised = revisedByNote.get(n.id)
    return {
      id: n.id,
      title: n.title,
      format: n.format,
      source: n.source,
      is_starred: n.is_starred,
      is_archived: n.is_archived,
      created_at: n.created_at,
      updated_at: n.updated_at,
      deleted_at: n.deleted_at,
      original_content: originalByNote.get(n.id)?.content ?? '',
      revised_content: revised?.content ?? null,
      ai_metadata: (revised?.ai_metadata as Record<string, unknown> | null) ?? null,
      collection_id: collectionByNote.get(n.id) ?? null,
      attachments: attachmentsByNote.get(n.id),
      tags: tagsByNote.get(n.id) ?? [],
    }
  })

  const exportedNoteIds = new Set(browserNotes.map((n) => n.id))
  const exportedAttachmentRows = orderedAttachments.filter((attachment) =>
    exportedNoteIds.has(attachment.note_id),
  )
  const projectedAttachmentCount = browserNotes.reduce(
    (count, note) => count + (note.attachments?.length ?? 0),
    0,
  )
  const sourceNoteById = new Map(notes.map((note) => [note.id, note]))
  const shardNotes = browserNotes.map((note) => {
    const mapped = noteToShard(note)
    if (!isRecordV1) return mapped
    const recordNote = {
      ...mapped,
      revised_content: mapped.revised_content ?? '',
      metadata: mapped.metadata ?? null,
      attachments: mapped.attachments ?? [],
    }
    if (recordSchemaVersion !== '2.0.0') return recordNote
    const storedPresence = sourceNoteById.get(note.id)?.__fortemi_presence
      ?? Object.fromEntries(
        presencePointers('record-v1', 'notes')
          .filter((pointer) => pointer === '/deleted_at')
          .map((pointer) => [pointer, 'legacy-indeterminate' as const]),
      )
    return restoreStoredPresence(
      recordNote as unknown as Record<string, unknown>,
      storedPresence,
    ) as unknown as ShardNote
  })

  let layout: ShardLayout | undefined
  const clusterSize = options?.clusterNotesSize
  if (clusterSize && Number.isInteger(clusterSize) && clusterSize > 0 && shardNotes.length > 0) {
    const clusters: ShardClusterRef[] = []
    for (let offset = 0; offset < shardNotes.length; offset += clusterSize) {
      const slice = shardNotes.slice(offset, offset + clusterSize)
      const href = `notes/${String(offset).padStart(6, '0')}.jsonl`
      clusters.push({ href, offset })
      files.set(href, encoder.encode(slice.map((n) => JSON.stringify(n)).join('\n')))
    }
    layout = { clusters: { notes: clusters } }
  } else {
    files.set('notes.jsonl', encoder.encode(shardNotes.map((n) => JSON.stringify(n)).join('\n')))
  }
  components.push('notes')
  counts.notes = shardNotes.length

  const orderedCollections = collections
    .sort((a, b) => a.name.localeCompare(b.name))
  const shardCollections = orderedCollections.map((c) => {
    const mapped = collectionToShard(
      {
        id: c.id,
        name: c.name,
        description: c.description,
        parent_id: c.parent_id ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at,
        deleted_at: c.deleted_at,
      },
      membershipNoteIds.get(c.id)?.size ?? 0,
    )
    if (!isRecordV1) return mapped
    return {
      id: mapped.id,
      name: mapped.name,
      description: mapped.description,
      parent_id: mapped.parent_id,
      created_at: mapped.created_at,
      note_count: mapped.note_count ?? 0,
    }
  })
  files.set('collections.json', encoder.encode(JSON.stringify(shardCollections)))
  components.push('collections')
  counts.collections = shardCollections.length

  const distinctTags = [...new Set(
    tagRows
      .filter((t) => exportedNoteIds.has(t.note_id) || (!options?.collectionId && !options?.tag))
      .map((t) => t.tag),
  )].sort()
  const tagCreatedAt = new Map<string, string>()
  for (const row of tagRows) {
    const current = tagCreatedAt.get(row.tag)
    if (!current || row.created_at < current) tagCreatedAt.set(row.tag, row.created_at)
  }
  const shardTags = tagsToShard(
    distinctTags.map((name) => ({
      name,
      created_at: tagCreatedAt.get(name) ?? new Date(0).toISOString(),
    })),
  )
  files.set('tags.json', encoder.encode(JSON.stringify(shardTags)))
  components.push('tags')
  counts.tags = shardTags.length

  const links = await store.list('link')
  const isFiltered = !!(options?.collectionId || options?.tag)
  const shardLinks = links
    .filter((l) => !isFiltered || (exportedNoteIds.has(l.source_note_id) && exportedNoteIds.has(l.target_note_id)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((l) => linkToShard({
      id: l.id,
      source_note_id: l.source_note_id,
      target_note_id: l.target_note_id,
      link_type: l.link_type,
      // record-v1 requires a numeric score; canonical links carry no
      // confidence column, so the profile's documented neutral default is 0.
      confidence: isRecordV1 ? 0 : null,
      created_at: l.created_at,
      deleted_at: l.deleted_at,
    }))
  files.set('links.jsonl', encoder.encode(shardLinks.map((l) => JSON.stringify(l)).join('\n')))
  components.push('links')
  counts.links = shardLinks.length

  const checksums: Record<string, string> = {}
  for (const [filename, data] of files) {
    checksums[filename] = await sha256Hex(data)
  }

  if (isRecordV1) {
    const nullRevisions = browserNotes.filter((note) => note.revised_content === null).length
    if (nullRevisions > 0) {
      losses.push({
        code: 'null-revised-content-normalized',
        component: 'notes',
        count: nullRevisions,
        message: `${nullRevisions} note(s) with null revised content were normalized to an empty string.`,
      })
    }
    if (projectedAttachmentCount > 0) {
      losses.push({
        code: 'attachment-lifecycle-outside-profile',
        component: 'notes',
        count: projectedAttachmentCount,
        message: `${projectedAttachmentCount} attachment projection(s) omit RecordStore lifecycle timestamps and byte sidecars.`,
      })
    }
    const omittedAttachments = exportedAttachmentRows.length - projectedAttachmentCount
    if (omittedAttachments > 0) {
      losses.push({
        code: 'attachment-blob-record-missing',
        component: 'notes',
        count: omittedAttachments,
        message: `${omittedAttachments} attachment record(s) without a matching blob record were omitted.`,
      })
    }
    if (shardLinks.length > 0) {
      losses.push({
        code: 'link-confidence-defaulted',
        component: 'links',
        count: shardLinks.length,
        message: `${shardLinks.length} link score(s) were set to 0 because RecordStore has no confidence field.`,
      })
    }
    const collectionStateLosses = orderedCollections.filter(
      (collection) =>
        collection.deleted_at !== null
        || collection.updated_at !== collection.created_at,
    ).length
    if (collectionStateLosses > 0) {
      losses.push({
        code: 'collection-lifecycle-outside-profile',
        component: 'collections',
        count: collectionStateLosses,
        message: `${collectionStateLosses} collection lifecycle state(s) are outside record-v1 and were omitted.`,
      })
    }
  }

  const manifest: ShardManifest = isRecordV1
    ? {
        version: recordSchemaVersion,
        profile: 'record-v1',
        producer: {
          name: 'fortemi-react-record-store',
          version: VERSION,
        },
        format: SHARD_FORMAT,
        created_at: new Date().toISOString(),
        components,
        counts: {
          notes: counts.notes ?? 0,
          collections: counts.collections ?? 0,
          tags: counts.tags ?? 0,
          templates: 0,
          links: counts.links ?? 0,
          embedding_sets: 0,
          embedding_set_members: 0,
          embeddings: 0,
          embedding_configs: 0,
        },
        checksums,
        min_reader_version: recordSchemaVersion,
      }
    : {
        version: CURRENT_SHARD_VERSION,
        matric_version: VERSION,
        format: SHARD_FORMAT,
        created_at: new Date().toISOString(),
        components,
        counts,
        checksums,
        min_reader_version: '1.0.0',
        migrated_from: null,
        migration_history: [],
        ...(layout ? { layout } : {}),
      }
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))

  // Portable byte sidecar — self-verifying `blobs/<hex>` entries, one per
  // distinct projected content hash; a blob the store cannot return is skipped
  // (its attachment stays reference-only).
  if (options?.includeBlobs && options.blobStore) {
    const packed = new Set<string>()
    for (const checksum of exportedBlobChecksums) {
      if (packed.has(checksum)) continue
      packed.add(checksum)
      const bytes = await options.blobStore.read(checksum)
      if (bytes) files.set(sidecarEntryName(checksum), bytes)
    }
  }

  return {
    archive: packTarGz(files),
    losses,
  }
}

// ── Import ───────────────────────────────────────────────────────────────────

/** Shard components the canonical record tier cannot persist. */
const UNSUPPORTED_COMPONENTS: readonly ShardComponent[] = [
  'templates',
  'embedding_sets',
  'embedding_configs',
  'embedding_set_members',
  'embeddings',
  'skos_schemes',
  'skos_concepts',
  'skos_relations',
  'note_skos_tags',
  'provenance_edges',
  'graph_sources',
  'graph_edges',
  'communities',
  'community_assignments',
]

function failure(
  counts: ImportCounts,
  skipped: Partial<ImportCounts>,
  warnings: string[],
  error: string,
  start: number,
  capabilityReport: ShardCapabilityReport,
): ImportResult {
  return {
    success: false,
    counts,
    skipped,
    warnings,
    errors: [error],
    duration_ms: performance.now() - start,
    capability_report: capabilityReport,
  }
}

/**
 * Import a `.shard` archive into the canonical RecordStore (and optionally
 * hydrate attachment bytes into a Bytecask BlobStore) with zero PGlite.
 *
 * Honors `conflictStrategy` (`skip` default / `replace` / `error` — `error`
 * conflicts are pre-scanned so nothing is written), the ADR-014
 * `verifySignature`/`trustStore` policy, and byte-sidecar hydration via
 * `blobStore`. Components the canonical tier cannot persist are skipped with
 * explicit warnings and reported under `skipped`.
 */
export async function importShardToRecords(
  store: RecordStore,
  data: Uint8Array | ArrayBuffer,
  options?: ImportOptions,
): Promise<ImportResult> {
  const start = performance.now()
  const strategy = options?.conflictStrategy ?? 'skip'
  const counts = emptyCounts()
  const skipped: Partial<ImportCounts> = {}
  const warnings: string[] = []
  let capabilityReport = createShardCapabilityReport({
    backend: 'record-store',
    operation: 'import',
    requestedProfile: null,
  })
  const inputData = data instanceof ArrayBuffer ? new Uint8Array(data) : data

  // ── Unpack + validate everything BEFORE any write ─────────────────────────
  let files: Map<string, Uint8Array>
  try {
    files = unpackTarGz(inputData)
  } catch (err) {
    return failure(
      counts,
      skipped,
      warnings,
      `Failed to decompress archive: ${err instanceof Error ? err.message : String(err)}`,
      start,
      capabilityReport,
    )
  }

  const manifestData = files.get('manifest.json')
  if (!manifestData) {
    return failure(
      counts,
      skipped,
      warnings,
      'Missing manifest.json in shard archive',
      start,
      capabilityReport,
    )
  }
  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestData)) as ShardManifest
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest must be a JSON object')
    }
  } catch {
    return failure(
      counts,
      skipped,
      warnings,
      'Invalid manifest.json: failed to parse JSON',
      start,
      capabilityReport,
    )
  }

  capabilityReport = createShardCapabilityReport({
    backend: 'record-store',
    operation: 'import',
    requestedProfile: manifest.profile ?? null,
    requestedSchemaVersion: manifest.version,
    declaredComponents: manifest.components ?? [],
    losses: manifest.profile
      ? []
      : [{
          code: 'legacy-unprofiled',
          message: 'The archive has no authority-owned portability profile and is not advertised as portable.',
        }],
  })
  if (manifest.version === '2.0.0' && manifest.profile === 'record-v1') {
    const filesByComponent: Partial<Record<ShardComponent, [string, 'json-array' | 'jsonl']>> = {
      notes: ['notes.jsonl', 'jsonl'], collections: ['collections.json', 'json-array'],
      tags: ['tags.json', 'json-array'], links: ['links.jsonl', 'jsonl'],
    }
    const presence = presenceLosses('record-v1', 'manifest', manifest as unknown as Record<string, unknown>)
    for (const component of manifest.components ?? []) {
      const spec = filesByComponent[component]
      if (!spec) continue
      try {
        const records = spec[1] === 'json-array'
          ? parseJsonArrayBytes<Record<string, unknown>>(files.get(spec[0]))
          : parseJsonlBytes<Record<string, unknown>>(files.get(spec[0]))
        presence.push(...componentPresenceLosses('record-v1', component, records))
      } catch {
        // Structural validation below owns parse diagnostics.
      }
    }
    capabilityReport = { ...capabilityReport, losses: presence }
  }

  if (manifest.profile === 'core-v1') {
    const validation = await validateCoreV1ShardArchive(files)
    if (!validation.valid) {
      return failure(
        counts,
        skipped,
        warnings,
        `Canonical core-v1 validation failed: ${validation.errors.join('; ')}`,
        start,
        capabilityReport,
      )
    }
  } else if (manifest.profile === 'record-v1') {
    const validation = await validateRecordV1ShardArchive(files)
    if (!validation.valid) {
      return failure(
        counts,
        skipped,
        warnings,
        `Canonical record-v1 validation failed: ${validation.errors.join('; ')}`,
        start,
        capabilityReport,
      )
    }
  }

  const unsupportedProfile = profileSupportError(capabilityReport)
  if (unsupportedProfile) {
    return failure(
      counts,
      skipped,
      warnings,
      unsupportedProfile,
      start,
      capabilityReport,
    )
  }
  if (manifest.min_reader_version && compareShardVersions(manifest.min_reader_version, MAX_SHARD_READER_VERSION) > 0) {
    return failure(counts, skipped, warnings,
      `Shard requires reader version ${manifest.min_reader_version}, ` +
        `but this version supports up to ${MAX_SHARD_READER_VERSION}`, start, capabilityReport)
  }

  // ADR-014 verify-before-persist: identical gate to the PGlite importer.
  const sigError = await enforceSignaturePolicy(files, options, warnings)
  if (sigError) return failure(counts, skipped, warnings, sigError, start, capabilityReport)

  if (!manifest.checksums || typeof manifest.checksums !== 'object') {
    return failure(
      counts,
      skipped,
      warnings,
      'Invalid manifest.json: checksums must be an object',
      start,
      capabilityReport,
    )
  }
  const checksumResult = await validateChecksums(manifest.checksums, files)
  if (!checksumResult.valid) {
    return failure(counts, skipped, warnings,
      `Checksum validation failed for: ${checksumResult.failures.join(', ')}`,
      start,
      capabilityReport,
    )
  }

  const sidecarBlobs = options?.blobStore ? collectSidecarBlobs(files) : null

  // ── Parse supported components ─────────────────────────────────────────────
  const noteClusters = manifest.layout?.clusters?.notes
  let parsedNotes: ShardNote[]
  let parsedCollections: ShardCollection[]
  let parsedLinks: ShardLink[]
  let parsedTags: ShardTag[]
  try {
    parsedNotes = noteClusters && noteClusters.length > 0
      ? [...noteClusters].sort((a, b) => a.offset - b.offset).flatMap((ref) => parseJsonlBytes<ShardNote>(files.get(ref.href)))
      : parseJsonlBytes<ShardNote>(files.get('notes.jsonl'))
    parsedCollections = parseJsonArrayBytes<ShardCollection>(files.get('collections.json'))
    parsedLinks = parseJsonlBytes<ShardLink>(files.get('links.jsonl'))
    parsedTags = parseJsonArrayBytes<ShardTag>(files.get('tags.json'))
  } catch (err) {
    return failure(counts, skipped, warnings,
      `Failed to parse shard component: ${err instanceof Error ? err.message : String(err)}`,
      start,
      capabilityReport,
    )
  }

  // Report the capability boundary explicitly: components present in the
  // shard that the canonical record tier cannot persist.
  for (const component of manifest.components ?? []) {
    if ((UNSUPPORTED_COMPONENTS as readonly string[]).includes(component)) {
      const count = manifest.counts?.[component]
      const key = (component === 'communities' ? 'communities' : component) as keyof ImportCounts
      skipped[key] = (skipped[key] ?? 0) + (typeof count === 'number' ? count : 0)
      warnings.push(
        `Shard component '${component}' is not supported by the canonical record tier and was skipped. ` +
          'Import into a PGlite-backed store to preserve it.',
      )
    }
  }

  const applyBatch = store.applyBatch?.bind(store)
  if (!applyBatch) {
    return failure(
      counts,
      skipped,
      warnings,
      'RecordStore must implement applyBatch() before shard records can be imported atomically',
      start,
      capabilityReport,
    )
  }

  const [
    storedCollections,
    storedNotes,
    storedOriginals,
    storedRevised,
    storedTags,
    storedMemberships,
    storedAttachments,
    storedBlobs,
    storedLinks,
  ] = await Promise.all([
    store.list('collection'),
    store.list('note'),
    store.list('note_original'),
    store.list('note_revised_current'),
    store.list('note_tag'),
    store.list('collection_note'),
    store.list('attachment'),
    store.list('attachment_blob'),
    store.list('link'),
  ])
  const collectionsById = new Map(storedCollections.map((record) => [record.id, record]))
  const notesById = new Map(storedNotes.map((record) => [record.id, record]))
  const originalsByNote = new Map(storedOriginals.map((record) => [record.note_id, record]))
  const revisedByNote = new Map(storedRevised.map((record) => [record.id, record]))
  const blobsByChecksum = new Map(storedBlobs.map((record) => [record.content_hash, record]))
  const linksById = new Map(storedLinks.map((record) => [record.id, record]))
  const tagsByNote = new Map<string, typeof storedTags>()
  const membershipsByNote = new Map<string, typeof storedMemberships>()
  const attachmentsByNote = new Map<string, typeof storedAttachments>()
  for (const tag of storedTags) {
    const records = tagsByNote.get(tag.note_id) ?? []
    records.push(tag)
    tagsByNote.set(tag.note_id, records)
  }
  for (const membership of storedMemberships) {
    const records = membershipsByNote.get(membership.note_id) ?? []
    records.push(membership)
    membershipsByNote.set(membership.note_id, records)
  }
  for (const attachment of storedAttachments) {
    const records = attachmentsByNote.get(attachment.note_id) ?? []
    records.push(attachment)
    attachmentsByNote.set(attachment.note_id, records)
  }

  if (strategy === 'error') {
    for (const col of parsedCollections) {
      if (collectionsById.has(col.id)) {
        return failure(counts, skipped, warnings, `Collection already exists: ${col.id}`, start, capabilityReport)
      }
    }
    for (const note of parsedNotes) {
      if (notesById.has(note.id)) {
        return failure(counts, skipped, warnings, `Note already exists: ${note.id}`, start, capabilityReport)
      }
    }
  }

  const mutations: RecordMutation[] = []
  const blobsToHydrate = new Map<string, Uint8Array>()
  const tagCreatedAt = new Map(parsedTags.map((tag) => [tag.name, tag.created_at]))
  const reconciledNoteIds = new Set<string>()
  let referenceOnlyCount = 0
  let notesWithAttachmentRefs = 0

  for (const shardCol of parsedCollections) {
    const col = collectionFromShard(shardCol)
    const existing = collectionsById.get(col.id)
    if (existing && strategy === 'skip') {
      skipped.collections = (skipped.collections ?? 0) + 1
      continue
    }
    if (existing && strategy === 'replace' && !shouldApplyReplacement(existing, col)) {
      skipped.collections = (skipped.collections ?? 0) + 1
      warnings.push(`Collection ${col.id} is older than destination state and was not replaced.`)
      continue
    }
    const record = {
      id: col.id,
      name: col.name,
      description: col.description,
      parent_id: col.parent_id,
      created_at: col.created_at,
      updated_at: col.updated_at,
      deleted_at: col.deleted_at,
    }
    mutations.push({ op: 'put', collection: 'collection', record })
    collectionsById.set(record.id, record)
    counts.collections++
  }

  for (const shardNote of parsedNotes) {
    const note = noteFromShard(shardNote)
    const createdAt = typeof note.created_at === 'string'
      ? note.created_at
      : note.created_at.toISOString()
    const updatedAt = typeof note.updated_at === 'string'
      ? note.updated_at
      : note.updated_at.toISOString()
    const deletedAt = note.deleted_at
      ? (typeof note.deleted_at === 'string' ? note.deleted_at : note.deleted_at.toISOString())
      : null
    const existing = notesById.get(note.id)
    if (existing && strategy === 'skip') {
      skipped.notes = (skipped.notes ?? 0) + 1
      continue
    }
    if (
      existing
      && strategy === 'replace'
      && !shouldApplyReplacement(existing, {
        created_at: createdAt,
        updated_at: updatedAt,
        deleted_at: deletedAt,
      })
    ) {
      skipped.notes = (skipped.notes ?? 0) + 1
      warnings.push(`Note ${note.id} is older than destination state and was not replaced.`)
      continue
    }

    const noteRecordBase = {
      id: note.id,
      archive_id: existing?.archive_id ?? null,
      title: note.title,
      format: note.format,
      source: note.source,
      visibility: existing?.visibility ?? 'private',
      revision_mode: existing?.revision_mode ?? 'standard',
      is_starred: note.is_starred,
      is_pinned: existing?.is_pinned ?? false,
      is_archived: note.is_archived,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deletedAt,
    }
    const notePresence = manifest.version === '2.0.0'
      ? capturePresence(
          shardNote,
          presencePointers('record-v1', 'notes').filter((pointer) => pointer === '/deleted_at'),
        )
      : null
    const noteRecord = (notePresence
      ? {
          ...restoreStoredPresence(
            noteRecordBase as unknown as Record<string, unknown>,
            notePresence,
          ),
          __fortemi_presence: notePresence,
        }
      : noteRecordBase) as unknown as NoteRecord0
    mutations.push({ op: 'put', collection: 'note', record: noteRecord })
    notesById.set(note.id, noteRecord)
    reconciledNoteIds.add(note.id)

    const existingOriginal = originalsByNote.get(note.id)
    const originalRecord = {
      id: existingOriginal?.id ?? generateId(),
      note_id: note.id,
      content: note.original_content,
      content_hash: computeHash(encoder.encode(note.original_content)),
      created_at: createdAt,
    }
    mutations.push({ op: 'put', collection: 'note_original', record: originalRecord })
    originalsByNote.set(note.id, originalRecord)

    const existingRevised = revisedByNote.get(note.id)
    const revisedRecord = {
      id: note.id,
      content: note.revised_content,
      ai_metadata: note.ai_metadata ?? null,
      generation_count: existingRevised?.generation_count ?? 0,
      model: existingRevised?.model ?? null,
      is_user_edited: existingRevised?.is_user_edited ?? false,
      updated_at: updatedAt,
    }
    mutations.push({ op: 'put', collection: 'note_revised_current', record: revisedRecord })
    revisedByNote.set(note.id, revisedRecord)

    const existingTags = tagsByNote.get(note.id) ?? []
    const incomingTags = new Set(note.tags)
    if (strategy === 'replace') {
      for (const tag of existingTags) {
        if (!incomingTags.has(tag.tag)) {
          mutations.push({ op: 'delete', collection: 'note_tag', id: tag.id })
        }
      }
    }
    for (const tag of note.tags) {
      const existingTag = existingTags.find((record) => record.tag === tag)
      if (!existingTag || strategy === 'replace') {
        mutations.push({
          op: 'put',
          collection: 'note_tag',
          record: {
            id: existingTag?.id ?? generateId(),
            note_id: note.id,
            tag,
            created_at: tagCreatedAt.get(tag) ?? createdAt,
          },
        })
      }
    }
    counts.tags += note.tags.length

    const existingMemberships = membershipsByNote.get(note.id) ?? []
    if (strategy === 'replace') {
      for (const membership of existingMemberships) {
        if (membership.collection_id !== note.collection_id) {
          mutations.push({ op: 'delete', collection: 'collection_note', id: membership.id })
        }
      }
    }
    if (note.collection_id && collectionsById.has(note.collection_id)) {
      const existingMembership = existingMemberships.find(
        (membership) => membership.collection_id === note.collection_id,
      )
      if (!existingMembership) {
        mutations.push({
          op: 'put',
          collection: 'collection_note',
          record: {
            id: generateId(),
            collection_id: note.collection_id,
            note_id: note.id,
            created_at: createdAt,
          },
        })
      }
    }

    const existingAttachments = attachmentsByNote.get(note.id) ?? []
    const incomingAttachmentIds = new Set(
      (note.attachments ?? []).map((projection) => projection.attachment.id),
    )
    if (strategy === 'replace') {
      for (const attachment of existingAttachments) {
        if (attachment.deleted_at === null && !incomingAttachmentIds.has(attachment.id)) {
          mutations.push({ op: 'delete', collection: 'attachment', id: attachment.id })
        }
      }
    }
    if (note.attachments?.length) {
      notesWithAttachmentRefs++
      for (let position = 0; position < note.attachments.length; position += 1) {
        const projection = note.attachments[position]
        const ref = projection.attachment
        let blob = blobsByChecksum.get(ref.checksum)
        if (!blob) {
          blob = {
            id: generateId(),
            content_hash: ref.checksum,
            size_bytes: ref.bytes,
            created_at: projection.created_at ?? createdAt,
          }
          mutations.push({ op: 'put', collection: 'attachment_blob', record: blob })
          blobsByChecksum.set(ref.checksum, blob)
        }
        const attachment: AttachmentRecord = {
          id: ref.id,
          note_id: note.id,
          blob_id: blob.id,
          document_type_id: null,
          mime_type: ref.mime,
          extracted_text: projection.extracted_text,
          filename: ref.path.split('/').filter(Boolean).pop() ?? ref.path,
          display_name: null,
          position,
          created_at: projection.created_at ?? createdAt,
          deleted_at: projection.deleted_at ?? null,
        }
        const existingAttachment = existingAttachments.find((record) => record.id === ref.id)
        if (
          !existingAttachment
          || (strategy === 'replace' && shouldApplyReplacement(existingAttachment, attachment))
        ) {
          mutations.push({ op: 'put', collection: 'attachment', record: attachment })
        }

        let hydrated = false
        if (sidecarBlobs) {
          if (blobsToHydrate.has(ref.checksum)) {
            hydrated = true
          } else {
            const bytes = sidecarBlobs.get(blobChecksumToHex(ref.checksum))
            if (bytes && computeBlobHash(bytes) === ref.checksum) {
              blobsToHydrate.set(ref.checksum, bytes)
              hydrated = true
            } else if (bytes) {
              warnings.push(
                `Sidecar blob for attachment ${ref.id} failed BLAKE3 integrity ` +
                  `check (expected ${ref.checksum}); imported as reference-only.`,
              )
            }
          }
        }
        if (!hydrated) referenceOnlyCount++
      }
    }
    counts.notes++
  }

  if (referenceOnlyCount > 0) {
    warnings.push(
      `${referenceOnlyCount} attachment reference(s) across ${notesWithAttachmentRefs} note(s) were imported as metadata only: ` +
        'no matching byte-sidecar entry (or no import blobStore), so getBlob() returns null until bytes are hydrated. ' +
        'Export a self-contained shard (`includeBlobs` + a `blobStore`) and import with a `blobStore` to hydrate bytes.',
    )
  }

  const incomingLinkIds = new Set<string>()
  for (const shardLink of parsedLinks) {
    const link = linkFromShard(shardLink)
    if (!link.target_note_id) {
      skipped.links = (skipped.links ?? 0) + 1
      warnings.push(
        link.to_url
          ? `URL link ${link.id} skipped: the canonical record tier does not persist URL-target links.`
          : `Shard link skipped: ${link.id} has neither to_note_id nor to_url.`,
      )
      continue
    }
    incomingLinkIds.add(link.id)
    const existing = linksById.get(link.id)
    if (existing && strategy === 'skip') {
      skipped.links = (skipped.links ?? 0) + 1
      continue
    }
    const linkRecord = {
      id: link.id,
      source_note_id: link.source_note_id,
      target_note_id: link.target_note_id,
      link_type: link.link_type,
      created_at: link.created_at,
      deleted_at: link.deleted_at,
    }
    if (
      existing
      && strategy === 'replace'
      && !shouldApplyReplacement(existing, {
        ...linkRecord,
        updated_at: link.updated_at,
      })
    ) {
      skipped.links = (skipped.links ?? 0) + 1
      warnings.push(`Link ${link.id} is older than destination state and was not replaced.`)
      continue
    }
    mutations.push({ op: 'put', collection: 'link', record: linkRecord })
    linksById.set(link.id, linkRecord)
    counts.links++
  }

  if (strategy === 'replace') {
    for (const existing of storedLinks) {
      if (
        reconciledNoteIds.has(existing.source_note_id)
        && existing.deleted_at === null
        && !incomingLinkIds.has(existing.id)
      ) {
        mutations.push({ op: 'delete', collection: 'link', id: existing.id })
      }
    }
  }

  let promotion
  try {
    promotion = await promoteBlobs(options?.blobStore, blobsToHydrate)
  } catch (err) {
    return failure(
      emptyCounts(),
      skipped,
      warnings,
      `Blob promotion failed (rolled back): ${err instanceof Error ? err.message : String(err)}`,
      start,
      capabilityReport,
    )
  }
  try {
    await applyBatch(mutations)
  } catch (err) {
    let rollbackError: unknown
    try {
      await promotion.rollback()
    } catch (rollbackFailure) {
      rollbackError = rollbackFailure
    }
    const rollbackSuffix = rollbackError
      ? `; blob rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      : ''
    return failure(
      emptyCounts(),
      skipped,
      warnings,
      `Record transaction failed (rolled back): ${err instanceof Error ? err.message : String(err)}${rollbackSuffix}`,
      start,
      capabilityReport,
    )
  }

  return {
    success: true,
    counts,
    skipped,
    warnings,
    errors: [],
    duration_ms: performance.now() - start,
    capability_report: capabilityReport,
  }
}
