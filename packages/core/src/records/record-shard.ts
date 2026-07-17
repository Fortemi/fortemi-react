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
 * and checksum validation all run BEFORE any record or byte is written, and
 * `error`-strategy conflicts are pre-scanned so a conflicting archive writes
 * nothing. Each record commit is then individually atomic and journaled; an
 * interrupted import leaves a recoverable prefix that a re-import with
 * `conflictStrategy: 'skip'` completes idempotently.
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @depends @packages/core/src/shard/schema-validator.ts
 * @created 2026-07-17
 * @agent Codex
 */

import type { RecordStore, AttachmentRecord, AttachmentBlobRecord } from './types.js'
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
import { compareShardVersions, CURRENT_SHARD_VERSION, SHARD_FORMAT } from '../shard/types.js'
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
  ShardAttachmentProjection,
} from '../shard/types.js'
import { parseJsonArrayBytes, parseJsonlBytes } from '../shard/parse.js'
import { validateCoreV1ShardArchive } from '../shard/schema-validator.js'

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
  const files = new Map<string, Uint8Array>()
  const components: ShardComponent[] = []
  const counts: ShardManifest['counts'] = {}

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

  let notes = allNotes.filter((n) => n.deleted_at === null)
  if (options?.collectionId) {
    const inCollection = membershipNoteIds.get(options.collectionId) ?? new Set<string>()
    notes = notes.filter((n) => inCollection.has(n.id))
  } else if (options?.tag) {
    notes = notes.filter((n) => tagsByNote.get(n.id)?.includes(options.tag!))
  }
  notes.sort((a, b) => a.created_at.localeCompare(b.created_at))

  const liveAttachments = attachments
    .filter((a) => a.deleted_at === null)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
  const attachmentsByNote = new Map<string, ShardAttachmentProjection[]>()
  const exportedBlobChecksums: string[] = []
  for (const att of liveAttachments) {
    const blob = blobById.get(att.blob_id)
    if (!blob) continue // manifest without a blob record cannot be projected
    const projection: ShardAttachmentProjection = {
      extracted_text: att.extracted_text,
      attachment: {
        // `path` is the display filename per the binary-attachment projection
        // contract — never a physical storage key.
        id: att.id,
        path: att.filename,
        mime: att.mime_type,
        checksum: blob.content_hash,
        bytes: blob.size_bytes,
      },
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
  const shardNotes = browserNotes.map((n) => noteToShard(n))

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

  const liveCollections = collections
    .filter((c) => c.deleted_at === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  const shardCollections = liveCollections.map((c) =>
    collectionToShard(
      // Canonical collections are flat (no parent hierarchy yet).
      { id: c.id, name: c.name, description: c.description, parent_id: null, created_at: c.created_at },
      membershipNoteIds.get(c.id)?.size ?? 0,
    ),
  )
  files.set('collections.json', encoder.encode(JSON.stringify(shardCollections)))
  components.push('collections')
  counts.collections = shardCollections.length

  const distinctTags = [...new Set(
    tagRows
      .filter((t) => exportedNoteIds.has(t.note_id) || (!options?.collectionId && !options?.tag))
      .map((t) => t.tag),
  )].sort()
  const shardTags = tagsToShard(distinctTags.map((name) => ({ name, created_at: new Date() })))
  files.set('tags.json', encoder.encode(JSON.stringify(shardTags)))
  components.push('tags')
  counts.tags = shardTags.length

  const links = await store.list('link')
  const isFiltered = !!(options?.collectionId || options?.tag)
  const shardLinks = links
    .filter((l) => l.deleted_at === null)
    .filter((l) => !isFiltered || (exportedNoteIds.has(l.source_note_id) && exportedNoteIds.has(l.target_note_id)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((l) => linkToShard({
      id: l.id,
      source_note_id: l.source_note_id,
      target_note_id: l.target_note_id,
      link_type: l.link_type,
      // Canonical links carry no confidence score (PGlite-tier column).
      confidence: null,
      created_at: l.created_at,
    }))
  files.set('links.jsonl', encoder.encode(shardLinks.map((l) => JSON.stringify(l)).join('\n')))
  components.push('links')
  counts.links = shardLinks.length

  const checksums: Record<string, string> = {}
  for (const [filename, data] of files) {
    checksums[filename] = await sha256Hex(data)
  }

  const manifest: ShardManifest = {
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
  // distinct live content hash; a blob the store cannot return is skipped
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

  return packTarGz(files)
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
): ImportResult {
  return {
    success: false,
    counts,
    skipped,
    warnings,
    errors: [error],
    duration_ms: performance.now() - start,
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
  const inputData = data instanceof ArrayBuffer ? new Uint8Array(data) : data

  // ── Unpack + validate everything BEFORE any write ─────────────────────────
  let files: Map<string, Uint8Array>
  try {
    files = unpackTarGz(inputData)
  } catch (err) {
    return failure(counts, skipped, warnings,
      `Failed to decompress archive: ${err instanceof Error ? err.message : String(err)}`, start)
  }

  const manifestData = files.get('manifest.json')
  if (!manifestData) {
    return failure(counts, skipped, warnings, 'Missing manifest.json in shard archive', start)
  }
  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestData)) as ShardManifest
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest must be a JSON object')
    }
  } catch {
    return failure(counts, skipped, warnings, 'Invalid manifest.json: failed to parse JSON', start)
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
      )
    }
  }

  if (manifest.min_reader_version && compareShardVersions(manifest.min_reader_version, CURRENT_SHARD_VERSION) > 0) {
    return failure(counts, skipped, warnings,
      `Shard requires reader version ${manifest.min_reader_version}, ` +
        `but this version supports up to ${CURRENT_SHARD_VERSION}`, start)
  }

  // ADR-014 verify-before-persist: identical gate to the PGlite importer.
  const sigError = await enforceSignaturePolicy(files, options, warnings)
  if (sigError) return failure(counts, skipped, warnings, sigError, start)

  if (!manifest.checksums || typeof manifest.checksums !== 'object') {
    return failure(counts, skipped, warnings, 'Invalid manifest.json: checksums must be an object', start)
  }
  const checksumResult = await validateChecksums(manifest.checksums, files)
  if (!checksumResult.valid) {
    return failure(counts, skipped, warnings,
      `Checksum validation failed for: ${checksumResult.failures.join(', ')}`, start)
  }

  const sidecarBlobs = options?.blobStore ? collectSidecarBlobs(files) : null

  // ── Parse supported components ─────────────────────────────────────────────
  const noteClusters = manifest.layout?.clusters?.notes
  let parsedNotes: ShardNote[]
  let parsedCollections: ShardCollection[]
  let parsedLinks: ShardLink[]
  try {
    parsedNotes = noteClusters && noteClusters.length > 0
      ? [...noteClusters].sort((a, b) => a.offset - b.offset).flatMap((ref) => parseJsonlBytes<ShardNote>(files.get(ref.href)))
      : parseJsonlBytes<ShardNote>(files.get('notes.jsonl'))
    parsedCollections = parseJsonArrayBytes<ShardCollection>(files.get('collections.json'))
    parsedLinks = parseJsonlBytes<ShardLink>(files.get('links.jsonl'))
  } catch (err) {
    return failure(counts, skipped, warnings,
      `Failed to parse shard component: ${err instanceof Error ? err.message : String(err)}`, start)
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

  // `error` strategy: pre-scan conflicts so a conflicting archive writes nothing.
  if (strategy === 'error') {
    for (const col of parsedCollections) {
      if (await store.get('collection', col.id)) {
        return failure(counts, skipped, warnings, `Collection already exists: ${col.id}`, start)
      }
    }
    for (const shardNote of parsedNotes) {
      if (await store.get('note', shardNote.id)) {
        return failure(counts, skipped, warnings, `Note already exists: ${shardNote.id}`, start)
      }
    }
  }

  // ── Collections ────────────────────────────────────────────────────────────
  const nowIso = new Date().toISOString()
  for (const shardCol of parsedCollections) {
    const col = collectionFromShard(shardCol)
    const existing = await store.get('collection', col.id)
    if (existing && strategy === 'skip') {
      skipped.collections = (skipped.collections ?? 0) + 1
      continue
    }
    await store.put('collection', {
      id: col.id,
      name: col.name,
      description: col.description,
      created_at: col.created_at,
      updated_at: existing?.updated_at ?? nowIso,
      deleted_at: existing?.deleted_at ?? null,
    })
    counts.collections++
  }

  // ── Notes (+ tags, memberships, attachment manifests) ──────────────────────
  const existingBlobs = await store.list('attachment_blob')
  const blobIdByChecksum = new Map(existingBlobs.map((b) => [b.content_hash, b.id]))
  const blobsToHydrate = new Map<string, Uint8Array>()
  let referenceOnlyCount = 0
  let notesWithAttachmentRefs = 0

  for (const shardNote of parsedNotes) {
    const note = noteFromShard(shardNote)
    const existing = await store.get('note', note.id)
    if (existing && strategy === 'skip') {
      skipped.notes = (skipped.notes ?? 0) + 1
      continue
    }

    await store.put('note', {
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
      created_at: typeof note.created_at === 'string' ? note.created_at : note.created_at.toISOString(),
      updated_at: typeof note.updated_at === 'string' ? note.updated_at : note.updated_at.toISOString(),
      deleted_at: note.deleted_at
        ? (typeof note.deleted_at === 'string' ? note.deleted_at : note.deleted_at.toISOString())
        : null,
    })

    const contentHash = computeHash(encoder.encode(note.original_content))
    const existingOriginal = existing
      ? (await store.list('note_original')).find((o) => o.note_id === note.id)
      : undefined
    await store.put('note_original', {
      id: existingOriginal?.id ?? generateId(),
      note_id: note.id,
      content: note.original_content,
      content_hash: contentHash,
      created_at: existingOriginal?.created_at ?? nowIso,
    })

    const existingRevised = existing ? await store.get('note_revised_current', note.id) : null
    await store.put('note_revised_current', {
      id: note.id,
      content: note.revised_content ?? note.original_content,
      ai_metadata: note.ai_metadata ?? null,
      generation_count: existingRevised?.generation_count ?? 0,
      model: existingRevised?.model ?? null,
      is_user_edited: existingRevised?.is_user_edited ?? false,
      updated_at: typeof note.updated_at === 'string' ? note.updated_at : note.updated_at.toISOString(),
    })

    const existingTags = new Set(
      (await store.list('note_tag')).filter((t) => t.note_id === note.id).map((t) => t.tag),
    )
    for (const tag of note.tags) {
      if (existingTags.has(tag)) continue // UNIQUE(note_id, tag)
      await store.put('note_tag', { id: generateId(), note_id: note.id, tag, created_at: nowIso })
    }

    if (note.collection_id && (await store.get('collection', note.collection_id))) {
      const member = (await store.list('collection_note')).find(
        (cn) => cn.collection_id === note.collection_id && cn.note_id === note.id,
      )
      if (!member) {
        await store.put('collection_note', {
          id: generateId(),
          collection_id: note.collection_id,
          note_id: note.id,
          created_at: nowIso,
        })
      }
    }

    if (note.attachments?.length) {
      notesWithAttachmentRefs++
      for (let position = 0; position < note.attachments.length; position += 1) {
        const projection = note.attachments[position]
        const ref = projection.attachment

        let blobId = blobIdByChecksum.get(ref.checksum)
        if (!blobId) {
          const blob: AttachmentBlobRecord = {
            id: generateId(),
            content_hash: ref.checksum,
            size_bytes: ref.bytes,
            created_at: nowIso,
          }
          await store.put('attachment_blob', blob)
          blobIdByChecksum.set(ref.checksum, blob.id)
          blobId = blob.id
        }

        const filename = ref.path.split('/').filter(Boolean).pop() ?? ref.path
        const attachment: AttachmentRecord = {
          id: ref.id,
          note_id: note.id,
          blob_id: blobId,
          document_type_id: null,
          mime_type: ref.mime,
          extracted_text: projection.extracted_text,
          filename,
          display_name: null,
          position,
          created_at: nowIso,
          deleted_at: null,
        }
        const existingAttachment = await store.get('attachment', ref.id)
        if (!existingAttachment || strategy === 'replace') {
          await store.put('attachment', {
            ...attachment,
            created_at: existingAttachment?.created_at ?? nowIso,
          })
        }

        // Sidecar hydration (verify against the BLAKE3 name before queueing);
        // an absent or corrupt entry leaves the attachment reference-only.
        let hydrated = false
        if (sidecarBlobs) {
          if (blobsToHydrate.has(ref.checksum)) {
            hydrated = true
          } else {
            const bytes = sidecarBlobs.get(blobChecksumToHex(ref.checksum))
            if (bytes) {
              if (computeBlobHash(bytes) === ref.checksum) {
                blobsToHydrate.set(ref.checksum, bytes)
                hydrated = true
              } else {
                warnings.push(
                  `Sidecar blob for attachment ${ref.id} failed BLAKE3 integrity ` +
                    `check (expected ${ref.checksum}); imported as reference-only.`,
                )
              }
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

  // ── Links (note-to-note only; URL links are a PGlite-tier capability) ──────
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
    const existing = await store.get('link', link.id)
    if (existing && strategy === 'skip') {
      skipped.links = (skipped.links ?? 0) + 1
      continue
    }
    await store.put('link', {
      id: link.id,
      source_note_id: link.source_note_id,
      target_note_id: link.target_note_id,
      link_type: link.link_type,
      created_at: link.created_at,
      deleted_at: existing?.deleted_at ?? null,
    })
    counts.links++
  }

  // ── Hydrate sidecar bytes (after all record commits) ───────────────────────
  const errors: string[] = []
  if (options?.blobStore && blobsToHydrate.size > 0) {
    try {
      for (const [, bytes] of blobsToHydrate) {
        await options.blobStore.put(bytes)
      }
    } catch (err) {
      warnings.push(
        `Imported records successfully but failed to hydrate ${blobsToHydrate.size} ` +
          `attachment blob(s) into the BlobStore: ${err instanceof Error ? err.message : String(err)}.`,
      )
    }
  }

  return {
    success: true,
    counts,
    skipped,
    warnings,
    errors,
    duration_ms: performance.now() - start,
  }
}
