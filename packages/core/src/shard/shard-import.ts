/**
 * Shard import pipeline — unpack, validate, field-map, transactional insert.
 *
 * Pipeline: ArrayBuffer → gunzip → untar → parse manifest → validate checksums →
 *           parse components → field-map → BEGIN transaction → INSERT all → COMMIT
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @depends @packages/core/src/shard/schema-validator.ts
 * @created 2026-07-17
 * @agent Codex
 */

import type { DatabaseClient, QueryExecutor } from '../storage-backend.js'
import { unpackTarGz } from './shard-tar.js'
import { validateChecksums } from './checksum.js'
import { collectSidecarBlobs, blobChecksumToHex } from './blob-sidecar.js'
import { verifyShardSignature } from './shard-signature.js'
import {
  noteFromShard,
  linkFromShard,
  collectionFromShard,
  embeddingSetFromShard,
  embeddingFromShard,
} from './field-mapper.js'
import { generateId } from '../uuid.js'
import { computeHash, computeBlobHash } from '../hash.js'
import { compareShardVersions, CURRENT_SHARD_VERSION } from './types.js'
import type {
  ShardManifest,
  ImportOptions,
  ImportResult,
  ImportCounts,
  ShardNote,
  ShardLink,
  ShardCollection,
  ShardTag,
  ShardTemplate,
  ShardEmbeddingSet,
  ShardEmbeddingConfig,
  ShardEmbeddingSetMember,
  ShardEmbedding,
  ShardSkosScheme,
  ShardSkosConcept,
  ShardSkosRelation,
  ShardNoteSkosTag,
  ShardProvenanceEdge,
  ShardGraphSource,
  ShardGraphEdge,
  ShardCommunitySet,
  ShardCommunityAssignment,
} from './types.js'
import { parseJsonArrayBytes, parseJsonlBytes } from './parse.js'
import { validateCoreV1ShardArchive } from './schema-validator.js'
import { promoteBlobs } from './blob-staging.js'
import { shouldApplyReplacement } from './convergence.js'
import {
  createShardCapabilityReport,
  profileSupportError,
} from './profile-registry.js'

const decoder = new TextDecoder()
const DEFAULT_BATCH_SIZE = 250

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

/**
 * Apply the ADR-014 signed-shard policy. Returns an error string to abort the
 * import (nothing persisted yet at the call site), or null to proceed.
 * Appends warnings for the acknowledged-unauthenticated cases.
 *
 * Exported for the canonical record-tier importer (`records/record-shard.ts`),
 * which runs the identical verify-before-persist gate without PGlite.
 */
export async function enforceSignaturePolicy(
  files: Map<string, Uint8Array>,
  options: ImportOptions | undefined,
  warnings: string[],
): Promise<string | null> {
  const policy = options?.verifySignature ?? (options?.trustStore ? 'require' : undefined)
  if (!policy) return null // signature verification not requested — unchanged behavior

  if (policy === 'trusted-local-only') {
    warnings.push(
      'Signature verification skipped (trusted-local-only): the shard was imported ' +
        'without authenticating its publisher.',
    )
    return null
  }

  if (!options?.trustStore) {
    return `verifySignature: '${policy}' requires a trustStore to resolve signer keys.`
  }

  const verdict = await verifyShardSignature({ files, trustStore: options.trustStore })
  if (verdict.ok) return null

  if (verdict.reason === 'unsigned') {
    if (policy === 'prefer') {
      warnings.push(
        'Shard is unsigned; imported under verifySignature: prefer. Publisher ' +
          'provenance was NOT authenticated.',
      )
      return null
    }
    return 'Shard is unsigned and verifySignature is required.'
  }

  // Every other reason is a hard rejection under both require and prefer:
  // a present-but-broken signature is never downgraded to "unsigned".
  const detail =
    'detail' in verdict ? `: ${verdict.detail}` : 'keyId' in verdict ? ` (key ${verdict.keyId})` : ''
  return `Shard signature verification failed [${verdict.reason}]${detail}. No records or bytes were written.`
}

async function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield) {
    await scheduler.yield()
    return
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function maybeYield(done: number, batchSize: number): Promise<void> {
  if (batchSize > 0 && done > 0 && done % batchSize === 0) {
    await yieldToEventLoop()
  }
}

/**
 * Import a .shard archive into the database.
 *
 * The entire import is wrapped in a single transaction — if anything fails,
 * all changes are rolled back.
 *
 * @param db DatabaseClient database instance
 * @param data Raw archive bytes (from File API or fetch)
 * @param options Import options (conflict strategy)
 * @returns Import result with counts, warnings, and errors
 */
export async function importShard(
  db: DatabaseClient,
  data: Uint8Array | ArrayBuffer,
  options?: ImportOptions,
): Promise<ImportResult> {
  const start = performance.now()
  const strategy = options?.conflictStrategy ?? 'skip'
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE
  const report = options?.onProgress
  const warnings: string[] = []
  const errors: string[] = []
  let importedAttachmentReferenceCount = 0
  let notesWithImportedAttachmentReferences = 0
  // Verified sidecar bytes staged before the logical transaction.
  const blobsToHydrate = new Map<string, Uint8Array>()
  const counts = emptyCounts()
  const skipped: Partial<ImportCounts> = {}
  let capabilityReport = createShardCapabilityReport({
    backend: 'pglite',
    operation: 'import',
    requestedProfile: null,
  })

  const inputData = data instanceof ArrayBuffer ? new Uint8Array(data) : data

  // ── Step 1: Unpack tar.gz ─────────────────────────────────────────────
  report?.({ phase: 'unpack', done: 0, total: 1 })
  let files: Map<string, Uint8Array>
  try {
    files = unpackTarGz(inputData)
    report?.({ phase: 'unpack', done: 1, total: 1 })
  } catch (err) {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: [`Failed to decompress archive: ${err instanceof Error ? err.message : String(err)}`],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  // ── Step 2: Parse and validate manifest ───────────────────────────────
  const manifestData = files.get('manifest.json')
  if (!manifestData) {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: ['Missing manifest.json in shard archive'],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestData))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest must be a JSON object')
    }
  } catch {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: ['Invalid manifest.json: failed to parse JSON'],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  capabilityReport = createShardCapabilityReport({
    backend: 'pglite',
    operation: 'import',
    requestedProfile: manifest.profile ?? null,
    declaredComponents: manifest.components ?? [],
    losses: manifest.profile
      ? []
      : [{
          code: 'legacy-unprofiled',
          message: 'The archive has no authority-owned portability profile and is not advertised as portable.',
        }],
  })
  const unsupportedProfile = profileSupportError(capabilityReport)
  if (unsupportedProfile) {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: [unsupportedProfile],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  if (manifest.profile === 'core-v1') {
    const validation = await validateCoreV1ShardArchive(files)
    if (!validation.valid) {
      return {
        success: false,
        counts,
        skipped,
        warnings,
        errors: [`Canonical core-v1 validation failed: ${validation.errors.join('; ')}`],
        duration_ms: performance.now() - start,
        capability_report: capabilityReport,
      }
    }
  }

  // Version compatibility check
  if (manifest.min_reader_version && compareShardVersions(manifest.min_reader_version, CURRENT_SHARD_VERSION) > 0) {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: [
        `Shard requires reader version ${manifest.min_reader_version}, ` +
        `but this version supports up to ${CURRENT_SHARD_VERSION}`,
      ],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  // ── Step 2.5: Verify publisher signature BEFORE any persistence ───────
  // (#324, ADR-013 D6 / ADR-014): nothing is written to canonical records,
  // the BlobStore, or PGlite until the signature verifies. Opt-in — skipped
  // entirely when neither a policy nor a trust store is supplied.
  const sigError = await enforceSignaturePolicy(files, options, warnings)
  if (sigError) {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: [sigError],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  // ── Step 3: Validate checksums ────────────────────────────────────────
  report?.({ phase: 'validate', done: 0, total: 1 })
  if (!manifest.checksums || typeof manifest.checksums !== 'object') {
    return {
      success: false, counts, skipped, warnings,
      errors: ['Invalid manifest.json: checksums must be an object'],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }
  const checksumResult = await validateChecksums(manifest.checksums, files)
  if (!checksumResult.valid) {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: [`Checksum validation failed for: ${checksumResult.failures.join(', ')}`],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }
  report?.({ phase: 'validate', done: 1, total: 1 })

  // Portable byte sidecar (Fortemi/fortemi#1046): content-addressed
  // `blobs/<hex>` entries, keyed by bare BLAKE3 hex. Only collected when a
  // BlobStore hydration destination is supplied; unreferenced entries are
  // ignored, and a missing entry leaves its attachment reference-only.
  const sidecarBlobs = options?.blobStore ? collectSidecarBlobs(files) : null

  // ── Step 4: Parse all components ──────────────────────────────────────
  // Notes may be clustered (notes/000.jsonl, …) per the manifest layout (#189);
  // a monolithic notes.jsonl is the default. Concatenate clusters in offset order.
  const noteClusters = manifest.layout?.clusters?.notes
  const parseComponent = <T>(name: string, parse: () => T): T => {
    try { return parse() } catch (err) {
      throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  let parsedNotes: ShardNote[]
  let parsedCollections: ShardCollection[]
  let parsedTags: ShardTag[]
  let parsedTemplates: ShardTemplate[]
  let parsedLinks: ShardLink[]
  let parsedEmbSets: ShardEmbeddingSet[]
  let parsedEmbConfigs: ShardEmbeddingConfig[]
  let parsedEmbMembers: ShardEmbeddingSetMember[]
  let parsedEmbeddings: ShardEmbedding[]
  let parsedSkosSchemes: ShardSkosScheme[]
  let parsedSkosConcepts: ShardSkosConcept[]
  let parsedSkosRelations: ShardSkosRelation[]
  let parsedNoteSkosTags: ShardNoteSkosTag[]
  let parsedProvenanceEdges: ShardProvenanceEdge[]
  let parsedGraphSources: ShardGraphSource[]
  let parsedGraphEdges: ShardGraphEdge[]
  let parsedCommunitySets: ShardCommunitySet[]
  let parsedCommunityAssignments: ShardCommunityAssignment[]
  try {
    parsedNotes = parseComponent('notes', () => noteClusters && noteClusters.length > 0
      ? [...noteClusters].sort((a, b) => a.offset - b.offset).flatMap((ref) => parseJsonlBytes<ShardNote>(files.get(ref.href)))
      : parseJsonlBytes<ShardNote>(files.get('notes.jsonl')))
    parsedCollections = parseComponent('collections.json', () => parseJsonArrayBytes<ShardCollection>(files.get('collections.json')))
    parsedTags = parseComponent('tags.json', () => parseJsonArrayBytes<ShardTag>(files.get('tags.json')))
    parsedTemplates = parseComponent('templates.json', () => parseJsonArrayBytes<ShardTemplate>(files.get('templates.json')))
    parsedLinks = parseComponent('links.jsonl', () => parseJsonlBytes<ShardLink>(files.get('links.jsonl')))
    parsedEmbSets = parseComponent('embedding_sets.json', () => parseJsonArrayBytes<ShardEmbeddingSet>(files.get('embedding_sets.json')))
    parsedEmbConfigs = parseComponent('embedding_configs.json', () => parseJsonArrayBytes<ShardEmbeddingConfig>(files.get('embedding_configs.json')))
    parsedEmbMembers = parseComponent('embedding_set_members.jsonl', () => parseJsonlBytes<ShardEmbeddingSetMember>(files.get('embedding_set_members.jsonl')))
    parsedEmbeddings = parseComponent('embeddings.jsonl', () => parseJsonlBytes<ShardEmbedding>(files.get('embeddings.jsonl')))
    parsedSkosSchemes = parseComponent('skos_schemes.json', () => parseJsonArrayBytes<ShardSkosScheme>(files.get('skos_schemes.json')))
    parsedSkosConcepts = parseComponent('skos_concepts.json', () => parseJsonArrayBytes<ShardSkosConcept>(files.get('skos_concepts.json')))
    parsedSkosRelations = parseComponent('skos_relations.jsonl', () => parseJsonlBytes<ShardSkosRelation>(files.get('skos_relations.jsonl')))
    parsedNoteSkosTags = parseComponent('note_skos_tags.jsonl', () => parseJsonlBytes<ShardNoteSkosTag>(files.get('note_skos_tags.jsonl')))
    parsedProvenanceEdges = parseComponent('provenance_edges.jsonl', () => parseJsonlBytes<ShardProvenanceEdge>(files.get('provenance_edges.jsonl')))
    parsedGraphSources = parseComponent('graph_sources.json', () => parseJsonArrayBytes<ShardGraphSource>(files.get('graph_sources.json')))
    parsedGraphEdges = parseComponent('graph_edges.jsonl', () => parseJsonlBytes<ShardGraphEdge>(files.get('graph_edges.jsonl')))
    parsedCommunitySets = parseComponent('communities.json', () => parseJsonArrayBytes<ShardCommunitySet>(files.get('communities.json')))
    parsedCommunityAssignments = parseComponent('community_assignments.jsonl', () => parseJsonlBytes<ShardCommunityAssignment>(files.get('community_assignments.jsonl')))
  } catch (err) {
    return {
      success: false, counts, skipped, warnings,
      errors: [`Failed to parse shard component: ${err instanceof Error ? err.message : String(err)}`],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  // Warn about unknown components
  const knownFiles = new Set([
    'manifest.json',
    'notes.jsonl',
    'collections.json',
    'tags.json',
    'links.jsonl',
    'embedding_sets.json',
    'embedding_set_members.jsonl',
    'embeddings.jsonl',
    'templates.json',
    'skos_schemes.json',
    'skos_concepts.json',
    'skos_relations.jsonl',
    'note_skos_tags.jsonl',
    'provenance_edges.jsonl',
    'graph_sources.json',
    'graph_edges.jsonl',
    'communities.json',
    'community_assignments.jsonl',
  ])
  for (const filename of files.keys()) {
    if (!knownFiles.has(filename)) {
      warnings.push(`Unknown component skipped: ${filename}`)
    }
  }

  const existingNoteRows = parsedNotes.length === 0
    ? { rows: [] as Array<{
        id: string
        created_at: Date | string
        updated_at: Date | string
        deleted_at: Date | string | null
      }> }
    : await db.query<{
        id: string
        created_at: Date | string
        updated_at: Date | string
        deleted_at: Date | string | null
      }>(
        `SELECT id, created_at, updated_at, deleted_at
           FROM note
          WHERE id = ANY($1::text[])`,
        [parsedNotes.map((note) => note.id)],
      )
  const existingNoteById = new Map(existingNoteRows.rows.map((note) => [note.id, note]))
  const eligibleNoteIds = new Set<string>()
  for (const shardNote of parsedNotes) {
    const existing = existingNoteById.get(shardNote.id)
    if (!existing || strategy === 'error') {
      eligibleNoteIds.add(shardNote.id)
      continue
    }
    if (strategy === 'skip') continue
    if (shouldApplyReplacement(existing, shardNote)) {
      eligibleNoteIds.add(shardNote.id)
    }
  }

  for (const shardNote of parsedNotes) {
    if (!eligibleNoteIds.has(shardNote.id) || !shardNote.attachments?.length) continue
    notesWithImportedAttachmentReferences++
    for (const projection of shardNote.attachments) {
      const ref = projection.attachment
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
      if (!hydrated) importedAttachmentReferenceCount++
    }
  }
  if (importedAttachmentReferenceCount > 0) {
    warnings.push(
      `${importedAttachmentReferenceCount} attachment reference(s) across ${notesWithImportedAttachmentReferences} note(s) were imported as metadata only: ` +
        'these shard records carry extracted text plus attachment metadata but no matching byte-sidecar entry, ' +
        'so their BlobStore bytes are unavailable (getBlob() returns null). Export a self-contained shard ' +
        '(`includeBlobs` + a `blobStore`) and import with a `blobStore` to hydrate bytes. Tracking: #271 / server #1046.',
    )
  }

  let promotion
  try {
    promotion = await promoteBlobs(options?.blobStore, blobsToHydrate)
  } catch (err) {
    return {
      success: false,
      counts: emptyCounts(),
      skipped,
      warnings,
      errors: [`Blob promotion failed (rolled back): ${err instanceof Error ? err.message : String(err)}`],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  // ── Step 5: Transactional insert ──────────────────────────────────────
  const conflictClause = strategy === 'skip' ? 'ON CONFLICT DO NOTHING' : ''
  const tagCreatedAt = new Map(parsedTags.map((tag) => [tag.name, tag.created_at]))

  try {
    await db.transaction(async (tx) => {
      const preexistingEmbeddingMembers = new Set<string>()
      if (strategy === 'skip') {
        for (const member of parsedEmbMembers) {
          const existing = await tx.query(
            'SELECT 1 FROM embedding_set_member WHERE embedding_set_id = $1 AND note_id = $2',
            [member.embedding_set_id, member.note_id],
          )
          if (existing.rows.length > 0) {
            preexistingEmbeddingMembers.add(`${member.embedding_set_id}\0${member.note_id}`)
          }
        }
      }

      const skipExisting = async (
        key: keyof ImportCounts,
        sql: string,
        params: unknown[],
      ): Promise<boolean> => {
        if (strategy !== 'skip') return false
        const existing = await tx.query(sql, params)
        if (existing.rows.length === 0) return false
        skipped[key] = (skipped[key] ?? 0) + 1
        return true
      }

      // Import collections first (notes may reference them)
      report?.({ phase: 'collections', done: 0, total: parsedCollections.length })
      for (const [index, shardCol] of parsedCollections.entries()) {
        const col = collectionFromShard(shardCol)
        if (await skipExisting('collections', 'SELECT 1 FROM collection WHERE id = $1', [col.id])) {
          report?.({ phase: 'collections', done: index + 1, total: parsedCollections.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        if (strategy === 'replace') {
          const existing = await tx.query<{
            created_at: Date | string
            updated_at: Date | string
            deleted_at: Date | string | null
          }>(
            `SELECT created_at, updated_at, deleted_at FROM collection WHERE id = $1`,
            [col.id],
          )
          if (
            existing.rows[0]
            && !shouldApplyReplacement(existing.rows[0], col)
          ) {
            skipped.collections = (skipped.collections ?? 0) + 1
            warnings.push(`Collection ${col.id} is older than destination state and was not replaced.`)
            report?.({ phase: 'collections', done: index + 1, total: parsedCollections.length })
            await maybeYield(index + 1, batchSize)
            continue
          }
          await tx.query(
            `INSERT INTO collection (
               id, name, description, parent_id, created_at, updated_at, deleted_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               name = $2, description = $3, parent_id = $4,
               created_at = $5, updated_at = $6, deleted_at = $7`,
            [
              col.id,
              col.name,
              col.description,
              col.parent_id,
              col.created_at,
              col.updated_at,
              col.deleted_at,
            ],
          )
        } else {
          await tx.query(
            `INSERT INTO collection (
               id, name, description, parent_id, created_at, updated_at, deleted_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7) ${conflictClause}`,
            [
              col.id,
              col.name,
              col.description,
              col.parent_id,
              col.created_at,
              col.updated_at,
              col.deleted_at,
            ],
          )
        }
        counts.collections++
        report?.({ phase: 'collections', done: index + 1, total: parsedCollections.length })
        await maybeYield(index + 1, batchSize)
      }

      // Import templates
      report?.({ phase: 'templates', done: 0, total: parsedTemplates.length })
      for (const [index, template] of parsedTemplates.entries()) {
        await tx.query(
          `INSERT INTO template (
             id, name, description, content, format, default_tags, collection_id, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
           ${strategy === 'replace'
             ? 'ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, content = $4, format = $5, default_tags = $6::jsonb, collection_id = $7, created_at = $8, updated_at = $9'
             : conflictClause}`,
          [
            template.id,
            template.name,
            template.description,
            template.content,
            template.format,
            JSON.stringify(template.default_tags),
            template.collection_id,
            template.created_at,
            template.updated_at,
          ],
        )
        counts.templates++
        report?.({ phase: 'templates', done: index + 1, total: parsedTemplates.length })
        await maybeYield(index + 1, batchSize)
      }

      // Import notes
      report?.({ phase: 'notes', done: 0, total: parsedNotes.length })
      for (const [index, shardNote] of parsedNotes.entries()) {
        const note = noteFromShard(shardNote)
        if (await skipExisting('notes', 'SELECT 1 FROM note WHERE id = $1', [note.id])) {
          report?.({ phase: 'notes', done: index + 1, total: parsedNotes.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        if (
          strategy === 'replace'
          && existingNoteById.has(note.id)
          && !eligibleNoteIds.has(note.id)
        ) {
          skipped.notes = (skipped.notes ?? 0) + 1
          warnings.push(`Note ${note.id} is older than destination state and was not replaced.`)
          report?.({ phase: 'notes', done: index + 1, total: parsedNotes.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        const contentHash = computeHash(new TextEncoder().encode(note.original_content))

        if (strategy === 'replace') {
          // Upsert note
          await tx.query(
            `INSERT INTO note (id, title, format, source, is_starred, is_archived, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET title = $2, format = $3, source = $4,
               is_starred = $5, is_archived = $6, created_at = $7,
               updated_at = $8, deleted_at = $9`,
            [
              note.id, note.title, note.format, note.source,
              note.is_starred, note.is_archived,
              note.created_at, note.updated_at, note.deleted_at,
            ],
          )
          // Upsert original — note_original has id PK, so check if one exists for this note_id
          const existingOrig = await tx.query(
            `SELECT id FROM note_original WHERE note_id = $1`,
            [note.id],
          )
          if (existingOrig.rows.length > 0) {
            await tx.query(
              `UPDATE note_original
                  SET content = $1, content_hash = $2, created_at = $3
                WHERE note_id = $4`,
              [note.original_content, contentHash, note.created_at, note.id],
            )
          } else {
            await tx.query(
              `INSERT INTO note_original (id, note_id, content, content_hash, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [generateId(), note.id, note.original_content, contentHash, note.created_at],
            )
          }
          await tx.query(
            `INSERT INTO note_revised_current (note_id, content, ai_metadata, updated_at)
             VALUES ($1, $2, $3::jsonb, $4)
             ON CONFLICT (note_id) DO UPDATE SET
               content = $2, ai_metadata = $3::jsonb, updated_at = $4`,
            [
              note.id,
              note.revised_content,
              note.ai_metadata == null ? null : JSON.stringify(note.ai_metadata),
              note.updated_at,
            ],
          )
        } else {
          // Insert note
          await tx.query(
            `INSERT INTO note (id, title, format, source, is_starred, is_archived, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ${conflictClause}`,
            [
              note.id, note.title, note.format, note.source,
              note.is_starred, note.is_archived,
              note.created_at, note.updated_at, note.deleted_at,
            ],
          )
          // Insert original (unique on note_id)
          await tx.query(
            `INSERT INTO note_original (id, note_id, content, content_hash, created_at)
             VALUES ($1, $2, $3, $4, $5) ${conflictClause}`,
            [generateId(), note.id, note.original_content, contentHash, note.created_at],
          )
          await tx.query(
            `INSERT INTO note_revised_current (note_id, content, ai_metadata, updated_at)
             VALUES ($1, $2, $3::jsonb, $4) ${conflictClause}`,
            [
              note.id,
              note.revised_content,
              note.ai_metadata == null ? null : JSON.stringify(note.ai_metadata),
              note.updated_at,
            ],
          )
        }

        // Import note tags
        if (strategy === 'replace') {
          await tx.query(
            `DELETE FROM note_tag
              WHERE note_id = $1
                AND NOT (tag = ANY($2::text[]))`,
            [note.id, note.tags],
          )
        }
        for (const tag of note.tags) {
          await tx.query(
            `INSERT INTO note_tag (id, note_id, tag, created_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (note_id, tag) DO UPDATE SET created_at = $4`,
            [generateId(), note.id, tag, tagCreatedAt.get(tag) ?? note.created_at],
          )
          counts.tags++
        }

        if (strategy === 'replace') {
          await tx.query(
            `DELETE FROM collection_note
              WHERE note_id = $1
                AND ($2::text IS NULL OR collection_id <> $2)`,
            [note.id, note.collection_id],
          )
        }
        if (note.collection_id) {
          await tx.query(
            `INSERT INTO collection_note (collection_id, note_id, added_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (collection_id, note_id) DO NOTHING`,
            [note.collection_id, note.id, note.created_at],
          )
        }

        const incomingAttachmentIds = (note.attachments ?? []).map(
          (projection) => projection.attachment.id,
        )
        if (strategy === 'replace') {
          await tx.query(
            `DELETE FROM attachment
              WHERE note_id = $1
                AND deleted_at IS NULL
                AND NOT (id = ANY($2::text[]))`,
            [note.id, incomingAttachmentIds],
          )
        }
        if (note.attachments?.length) {
          for (let position = 0; position < note.attachments.length; position += 1) {
            const projection = note.attachments[position]
            const ref = projection.attachment
            const existingBlob = await tx.query<{ id: string }>(
              `SELECT id FROM attachment_blob WHERE content_hash = $1`,
              [ref.checksum],
            )
            const blobId = existingBlob.rows[0]?.id ?? generateId()
            if (!existingBlob.rows.length) {
              await tx.query(
                `INSERT INTO attachment_blob (id, content_hash, size_bytes, storage_path)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (content_hash) DO NOTHING`,
                // storage_path stays NULL: the browser edition addresses blobs
                // by content_hash via the BlobStore, not a filesystem key, and
                // `ref.path` is the display filename (never a storage locator).
                [blobId, ref.checksum, ref.bytes, null],
              )
            }
            const filename = ref.path.split('/').filter(Boolean).pop() ?? ref.path
            if (strategy === 'replace') {
              const incomingAttachment = {
                created_at: projection.created_at ?? note.created_at,
                deleted_at: projection.deleted_at ?? null,
              }
              const existingAttachment = await tx.query<{
                created_at: Date | string
                deleted_at: Date | string | null
              }>(
                `SELECT created_at, deleted_at FROM attachment WHERE id = $1`,
                [ref.id],
              )
              if (
                existingAttachment.rows[0]
                && !shouldApplyReplacement(existingAttachment.rows[0], incomingAttachment)
              ) {
                warnings.push(
                  `Attachment ${ref.id} is older than destination state and was not replaced.`,
                )
                continue
              }
              await tx.query(
                `INSERT INTO attachment (
                   id, note_id, blob_id, filename, mime_type, extracted_text,
                   position, created_at, deleted_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (id) DO UPDATE SET
                   note_id = $2,
                   blob_id = $3,
                   filename = $4,
                   mime_type = $5,
                   extracted_text = $6,
                   position = $7,
                   created_at = $8,
                   deleted_at = $9`,
                [
                  ref.id,
                  note.id,
                  blobId,
                  filename,
                  ref.mime,
                  projection.extracted_text,
                  position,
                  projection.created_at ?? note.created_at,
                  projection.deleted_at ?? null,
                ],
              )
            } else {
              await tx.query(
                `INSERT INTO attachment (
                   id, note_id, blob_id, filename, mime_type, extracted_text,
                   position, created_at, deleted_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ${conflictClause}`,
                [
                  ref.id,
                  note.id,
                  blobId,
                  filename,
                  ref.mime,
                  projection.extracted_text,
                  position,
                  projection.created_at ?? note.created_at,
                  projection.deleted_at ?? null,
                ],
              )
            }
          }
        }

        counts.notes++
        report?.({ phase: 'notes', done: index + 1, total: parsedNotes.length })
        await maybeYield(index + 1, batchSize)
      }

      // Import SKOS schemes and concepts before note concept assignments.
      const totalSkos = parsedSkosSchemes.length + parsedSkosConcepts.length + parsedSkosRelations.length + parsedNoteSkosTags.length
      let doneSkos = 0
      report?.({ phase: 'skos', done: doneSkos, total: totalSkos })
      for (const scheme of parsedSkosSchemes) {
        if (await skipExisting('skos_schemes', 'SELECT 1 FROM skos_scheme WHERE id = $1', [scheme.id])) {
          report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
          await maybeYield(doneSkos, batchSize)
          continue
        }
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO skos_scheme (id, title, description, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET title = $2, description = $3, updated_at = $5`,
            [scheme.id, scheme.title, scheme.description, scheme.created_at, scheme.updated_at],
          )
        } else {
          await tx.query(
            `INSERT INTO skos_scheme (id, title, description, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5) ${conflictClause}`,
            [scheme.id, scheme.title, scheme.description, scheme.created_at, scheme.updated_at],
          )
        }
        counts.skos_schemes++
        report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
        await maybeYield(doneSkos, batchSize)
      }

      for (const concept of parsedSkosConcepts) {
        if (await skipExisting('skos_concepts', 'SELECT 1 FROM skos_concept WHERE id = $1', [concept.id])) {
          report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
          await maybeYield(doneSkos, batchSize)
          continue
        }
        const altLabels = JSON.stringify(concept.alt_labels ?? [])
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET scheme_id = $2, pref_label = $3, alt_labels = $4, definition = $5, updated_at = $7`,
            [concept.id, concept.scheme_id, concept.pref_label, altLabels, concept.definition, concept.created_at, concept.updated_at],
          )
        } else {
          await tx.query(
            `INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ${conflictClause}`,
            [concept.id, concept.scheme_id, concept.pref_label, altLabels, concept.definition, concept.created_at, concept.updated_at],
          )
        }
        counts.skos_concepts++
        report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
        await maybeYield(doneSkos, batchSize)
      }

      // Import links
      report?.({ phase: 'links', done: 0, total: parsedLinks.length })
      for (const [index, shardLink] of parsedLinks.entries()) {
        const link = linkFromShard(shardLink)
        if (!link.target_note_id) {
          if (!link.to_url) {
            skipped.links = (skipped.links ?? 0) + 1
            warnings.push(`Shard link skipped: ${link.id} has neither to_note_id nor to_url.`)
            report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
            await maybeYield(index + 1, batchSize)
            continue
          }
          const metadata = link.metadata == null ? null : JSON.stringify(link.metadata)
          if (strategy === 'replace') {
            const existing = await tx.query<{
              created_at: Date | string
              updated_at: Date | string | null
              deleted_at: Date | string | null
            }>(
              `SELECT created_at, updated_at, deleted_at FROM link_url_target WHERE id = $1`,
              [link.id],
            )
            if (existing.rows[0] && !shouldApplyReplacement(existing.rows[0], link)) {
              skipped.links = (skipped.links ?? 0) + 1
              warnings.push(`Link ${link.id} is older than destination state and was not replaced.`)
              report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
              await maybeYield(index + 1, batchSize)
              continue
            }
          }
          await tx.query(
            `INSERT INTO link_url_target (
               id, source_note_id, to_url, link_type, confidence, metadata_json,
               created_at, updated_at, deleted_at
             )
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
             ${strategy === 'replace'
               ? 'ON CONFLICT (id) DO UPDATE SET source_note_id = $2, to_url = $3, link_type = $4, confidence = $5, metadata_json = $6::jsonb, created_at = $7, updated_at = $8, deleted_at = $9'
               : conflictClause}`,
            [
              link.id,
              link.source_note_id,
              link.to_url,
              link.link_type,
              link.confidence,
              metadata,
              link.created_at,
              link.updated_at,
              link.deleted_at,
            ],
          )
          counts.links++
          report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        if (await skipExisting('links', 'SELECT 1 FROM link WHERE id = $1', [link.id])) {
          report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        if (strategy === 'replace') {
          const existing = await tx.query<{
            created_at: Date | string
            updated_at: Date | string | null
            deleted_at: Date | string | null
          }>(
            `SELECT created_at, updated_at, deleted_at FROM link WHERE id = $1`,
            [link.id],
          )
          if (existing.rows[0] && !shouldApplyReplacement(existing.rows[0], link)) {
            skipped.links = (skipped.links ?? 0) + 1
            warnings.push(`Link ${link.id} is older than destination state and was not replaced.`)
            report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
            await maybeYield(index + 1, batchSize)
            continue
          }
          await tx.query(
            `INSERT INTO link (
               id, source_note_id, target_note_id, link_type, confidence,
               created_at, updated_at, deleted_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               source_note_id = $2, target_note_id = $3, link_type = $4,
               confidence = $5, created_at = $6, updated_at = $7, deleted_at = $8`,
            [
              link.id,
              link.source_note_id,
              link.target_note_id,
              link.link_type,
              link.confidence,
              link.created_at,
              link.updated_at,
              link.deleted_at,
            ],
          )
        } else {
          await tx.query(
            `INSERT INTO link (
               id, source_note_id, target_note_id, link_type, confidence,
               created_at, updated_at, deleted_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ${conflictClause}`,
            [
              link.id,
              link.source_note_id,
              link.target_note_id,
              link.link_type,
              link.confidence,
              link.created_at,
              link.updated_at,
              link.deleted_at,
            ],
          )
        }
        counts.links++
        report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
        await maybeYield(index + 1, batchSize)
      }
      if (strategy === 'replace' && eligibleNoteIds.size > 0) {
        const noteIds = [...eligibleNoteIds]
        const noteLinkIds = parsedLinks
          .filter((link) => link.to_note_id !== null)
          .map((link) => link.id)
        const urlLinkIds = parsedLinks
          .filter((link) => link.to_note_id === null && Boolean(link.to_url))
          .map((link) => link.id)
        await tx.query(
          `DELETE FROM link
            WHERE source_note_id = ANY($1::text[])
              AND deleted_at IS NULL
              AND NOT (id = ANY($2::text[]))`,
          [noteIds, noteLinkIds],
        )
        await tx.query(
          `DELETE FROM link_url_target
            WHERE source_note_id = ANY($1::text[])
              AND deleted_at IS NULL
              AND NOT (id = ANY($2::text[]))`,
          [noteIds, urlLinkIds],
        )
      }

      // Import SKOS relations and note assignments after concepts and notes.
      for (const relation of parsedSkosRelations) {
        if (await skipExisting('skos_relations', 'SELECT 1 FROM skos_concept_relation WHERE id = $1', [relation.id])) {
          report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
          await maybeYield(doneSkos, batchSize)
          continue
        }
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO skos_concept_relation (id, source_concept_id, target_concept_id, relation_type, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET source_concept_id = $2, target_concept_id = $3, relation_type = $4`,
            [relation.id, relation.source_concept_id, relation.target_concept_id, relation.relation_type, relation.created_at],
          )
        } else {
          await tx.query(
            `INSERT INTO skos_concept_relation (id, source_concept_id, target_concept_id, relation_type, created_at)
             VALUES ($1, $2, $3, $4, $5) ${conflictClause}`,
            [relation.id, relation.source_concept_id, relation.target_concept_id, relation.relation_type, relation.created_at],
          )
        }
        counts.skos_relations++
        report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
        await maybeYield(doneSkos, batchSize)
      }

      for (const tag of parsedNoteSkosTags) {
        if (await skipExisting('note_skos_tags', 'SELECT 1 FROM note_skos_tag WHERE note_id = $1 AND concept_id = $2', [tag.note_id, tag.concept_id])) {
          report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
          await maybeYield(doneSkos, batchSize)
          continue
        }
        await tx.query(
          `INSERT INTO note_skos_tag (id, note_id, concept_id, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (note_id, concept_id) DO NOTHING`,
          [tag.id, tag.note_id, tag.concept_id, tag.created_at],
        )
        counts.note_skos_tags++
        report?.({ phase: 'skos', done: ++doneSkos, total: totalSkos })
        await maybeYield(doneSkos, batchSize)
      }

      // Import provenance edges.
      report?.({ phase: 'provenance', done: 0, total: parsedProvenanceEdges.length })
      for (const [index, edge] of parsedProvenanceEdges.entries()) {
        if (await skipExisting('provenance_edges', 'SELECT 1 FROM provenance_edge WHERE id = $1', [edge.id])) {
          report?.({ phase: 'provenance', done: index + 1, total: parsedProvenanceEdges.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        const attributes = edge.attributes === null ? null : JSON.stringify(edge.attributes)
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO provenance_edge (id, entity_type, entity_id, activity, agent, started_at, ended_at, attributes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET entity_type = $2, entity_id = $3, activity = $4, agent = $5, started_at = $6, ended_at = $7, attributes = $8`,
            [edge.id, edge.entity_type, edge.entity_id, edge.activity, edge.agent, edge.started_at, edge.ended_at, attributes],
          )
        } else {
          await tx.query(
            `INSERT INTO provenance_edge (id, entity_type, entity_id, activity, agent, started_at, ended_at, attributes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ${conflictClause}`,
            [edge.id, edge.entity_type, edge.entity_id, edge.activity, edge.agent, edge.started_at, edge.ended_at, attributes],
          )
        }
        counts.provenance_edges++
        report?.({ phase: 'provenance', done: index + 1, total: parsedProvenanceEdges.length })
        await maybeYield(index + 1, batchSize)
      }

      // Import embedding configs
      report?.({ phase: 'embedding_configs', done: 0, total: parsedEmbConfigs.length })
      for (const [index, config] of parsedEmbConfigs.entries()) {
        await tx.query(
          `INSERT INTO embedding_config (
             id, name, description, model, dimension, chunk_size, chunk_overlap, is_default
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ${strategy === 'replace'
             ? 'ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, model = $4, dimension = $5, chunk_size = $6, chunk_overlap = $7, is_default = $8'
             : conflictClause}`,
          [
            config.id,
            config.name,
            config.description,
            config.model,
            config.dimension,
            config.chunk_size,
            config.chunk_overlap,
            config.is_default,
          ],
        )
        counts.embedding_configs++
        report?.({ phase: 'embedding_configs', done: index + 1, total: parsedEmbConfigs.length })
        await maybeYield(index + 1, batchSize)
      }

      // Import embedding sets
      report?.({ phase: 'embedding_sets', done: 0, total: parsedEmbSets.length })
      for (const [index, shardSet] of parsedEmbSets.entries()) {
        const set = embeddingSetFromShard(shardSet, manifest.created_at)
        if (await skipExisting('embedding_sets', 'SELECT 1 FROM embedding_set WHERE id = $1', [set.id])) {
          report?.({ phase: 'embedding_sets', done: index + 1, total: parsedEmbSets.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO embedding_set (
               id, name, slug, description, purpose, document_count, embedding_count, is_system, keywords_json,
               model_name, dimensions, kind, mode, truncate_dimension,
               criteria_json, source_json, compatibility_json, materialization_json, freshness_json, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20, COALESCE($21::timestamptz, $20::timestamptz))
             ON CONFLICT (id) DO UPDATE SET name = $2, slug = $3, description = $4, purpose = $5,
               document_count = $6, embedding_count = $7, is_system = $8, keywords_json = $9::jsonb,
               model_name = $10, dimensions = $11, kind = $12, mode = $13, truncate_dimension = $14,
               criteria_json = $15::jsonb, source_json = $16::jsonb, compatibility_json = $17::jsonb,
               materialization_json = $18::jsonb, freshness_json = $19::jsonb, updated_at = COALESCE($21::timestamptz, $20::timestamptz)`,
            [set.id, set.name, set.slug, set.description, set.purpose, set.document_count, set.embedding_count, set.is_system, set.keywords_json, set.model_name, set.dimensions, set.kind, set.mode, set.truncate_dimension, set.criteria_json, set.source_json, set.compatibility_json, set.materialization_json, set.freshness_json, set.created_at, set.updated_at],
          )
        } else {
          await tx.query(
            `INSERT INTO embedding_set (
               id, name, slug, description, purpose, document_count, embedding_count, is_system, keywords_json,
               model_name, dimensions, kind, mode, truncate_dimension,
               criteria_json, source_json, compatibility_json, materialization_json, freshness_json, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20, COALESCE($21::timestamptz, $20::timestamptz)) ${conflictClause}`,
            [set.id, set.name, set.slug, set.description, set.purpose, set.document_count, set.embedding_count, set.is_system, set.keywords_json, set.model_name, set.dimensions, set.kind, set.mode, set.truncate_dimension, set.criteria_json, set.source_json, set.compatibility_json, set.materialization_json, set.freshness_json, set.created_at, set.updated_at],
          )
        }
        counts.embedding_sets++
        report?.({ phase: 'embedding_sets', done: index + 1, total: parsedEmbSets.length })
        await maybeYield(index + 1, batchSize)
      }

      // Import embeddings
      report?.({ phase: 'embeddings', done: 0, total: parsedEmbeddings.length })
      for (const [index, shardEmb] of parsedEmbeddings.entries()) {
        const emb = embeddingFromShard(shardEmb)
        const embeddingSetId = emb.embedding_set_id ?? await resolveEmbeddingSetIdForServerEmbedding(tx, emb.model, emb.vector)
        if (await skipExisting('embeddings', 'SELECT 1 FROM embedding WHERE id = $1', [emb.id])) {
          report?.({ phase: 'embeddings', done: index + 1, total: parsedEmbeddings.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text, vector, model, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
             ON CONFLICT (id) DO UPDATE SET embedding_set_id = $3, chunk_index = $4, text = $5, vector = $6, model = $7`,
            [emb.id, emb.note_id, embeddingSetId, emb.chunk_index, emb.text, emb.vector, emb.model, emb.created_at],
          )
        } else {
          await tx.query(
            `INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text, vector, model, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now())) ${conflictClause}`,
            [emb.id, emb.note_id, embeddingSetId, emb.chunk_index, emb.text, emb.vector, emb.model, emb.created_at],
          )
        }
        await tx.query(
          `INSERT INTO embedding_set_member (
             embedding_set_id, note_id, embedding_id, membership_type, added_at, added_by
           ) VALUES ($1, $2, $3, 'materialized', COALESCE($4::timestamptz, now()), 'shard-import')
           ON CONFLICT (embedding_set_id, note_id) DO UPDATE SET
             embedding_id = EXCLUDED.embedding_id,
             membership_type = CASE
               WHEN embedding_set_member.membership_type = 'auto' THEN 'materialized'
               ELSE embedding_set_member.membership_type
             END`,
          [embeddingSetId, emb.note_id, emb.id, emb.created_at],
        )
        counts.embeddings++
        report?.({ phase: 'embeddings', done: index + 1, total: parsedEmbeddings.length })
        await maybeYield(index + 1, batchSize)
      }



      // Import graph/community artifacts after primary graph inputs exist.
      const totalGraph = parsedGraphSources.length + parsedGraphEdges.length
      let doneGraph = 0
      report?.({ phase: 'graph', done: doneGraph, total: totalGraph })
      for (const source of parsedGraphSources) {
        if (await skipExisting('graph_sources', 'SELECT 1 FROM graph_source WHERE id = $1', [source.id])) {
          report?.({ phase: 'graph', done: ++doneGraph, total: totalGraph })
          await maybeYield(doneGraph, batchSize)
          continue
        }
        const parameters = source.parameters == null ? null : JSON.stringify(source.parameters)
        const freshness = JSON.stringify({ ...(source.freshness ?? {}), status: 'unknown' })
        await tx.query(
          `INSERT INTO graph_source (
             id, name, kind, source_table, embedding_set_id, virtual_set_id, model, dimension,
             truncate_dimension, metric, algorithm, parameters_json, input_hash, freshness_json, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15)
           ${strategy === 'replace'
             ? 'ON CONFLICT (id) DO UPDATE SET name = $2, kind = $3, source_table = $4, embedding_set_id = $5, virtual_set_id = $6, model = $7, dimension = $8, truncate_dimension = $9, metric = $10, algorithm = $11, parameters_json = $12::jsonb, input_hash = $13, freshness_json = $14::jsonb, created_at = $15'
             : conflictClause}`,
          [source.id, source.name, source.kind, source.source_table ?? null, source.embedding_set_id ?? null, source.virtual_set_id ?? null, source.model ?? null, source.dimension ?? null, source.truncate_dimension ?? null, source.metric ?? null, source.algorithm ?? null, parameters, source.input_hash, freshness, source.created_at],
        )
        counts.graph_sources++
        report?.({ phase: 'graph', done: ++doneGraph, total: totalGraph })
        await maybeYield(doneGraph, batchSize)
      }

      for (const edge of parsedGraphEdges) {
        if (await skipExisting(
          'graph_edges',
          'SELECT 1 FROM graph_edge_artifact WHERE graph_source_id = $1 AND from_note_id = $2 AND to_note_id = $3 AND kind = $4',
          [edge.graph_source_id, edge.from_note_id, edge.to_note_id, edge.kind],
        )) {
          report?.({ phase: 'graph', done: ++doneGraph, total: totalGraph })
          await maybeYield(doneGraph, batchSize)
          continue
        }
        const metadata = edge.metadata == null ? null : JSON.stringify(edge.metadata)
        await tx.query(
          `INSERT INTO graph_edge_artifact (graph_source_id, from_note_id, to_note_id, weight, kind, rank, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ${strategy === 'replace'
             ? 'ON CONFLICT (graph_source_id, from_note_id, to_note_id, kind) DO UPDATE SET weight = $4, rank = $6, metadata_json = $7::jsonb'
             : conflictClause}`,
          [edge.graph_source_id, edge.from_note_id, edge.to_note_id, edge.weight, edge.kind, edge.rank ?? null, metadata],
        )
        counts.graph_edges++
        report?.({ phase: 'graph', done: ++doneGraph, total: totalGraph })
        await maybeYield(doneGraph, batchSize)
      }

      const totalCommunities = parsedCommunitySets.length + parsedCommunitySets.reduce((sum, set) => sum + (set.communities?.length ?? 0), 0) + parsedCommunityAssignments.length
      let doneCommunities = 0
      report?.({ phase: 'communities', done: doneCommunities, total: totalCommunities })
      for (const set of parsedCommunitySets) {
        const parameters = set.parameters == null ? null : JSON.stringify(set.parameters)
        const freshness = JSON.stringify({ ...(set.freshness ?? {}), status: 'unknown' })
        const skippedSet = await skipExisting('community_sets', 'SELECT 1 FROM community_set WHERE id = $1', [set.id])
        if (!skippedSet) await tx.query(
          `INSERT INTO community_set (id, graph_source_id, name, source_type, algorithm, parameters_json, input_hash, freshness_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
           ${strategy === 'replace'
             ? 'ON CONFLICT (id) DO UPDATE SET graph_source_id = $2, name = $3, source_type = $4, algorithm = $5, parameters_json = $6::jsonb, input_hash = $7, freshness_json = $8::jsonb, created_at = $9'
             : conflictClause}`,
          [set.id, set.graph_source_id, set.name, set.source_type, set.algorithm ?? null, parameters, set.input_hash, freshness, set.created_at],
        )
        if (!skippedSet) counts.community_sets++
        report?.({ phase: 'communities', done: ++doneCommunities, total: totalCommunities })
        await maybeYield(doneCommunities, batchSize)

        for (const community of set.communities ?? []) {
          if (await skipExisting('communities', 'SELECT 1 FROM community WHERE community_set_id = $1 AND id = $2', [set.id, community.id])) {
            report?.({ phase: 'communities', done: ++doneCommunities, total: totalCommunities })
            await maybeYield(doneCommunities, batchSize)
            continue
          }
          const metadata = community.metadata == null ? null : JSON.stringify(community.metadata)
          await tx.query(
            `INSERT INTO community (community_set_id, id, label, rank, size, confidence, representative_note_ids, metadata_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
             ${strategy === 'replace'
               ? 'ON CONFLICT (community_set_id, id) DO UPDATE SET label = $3, rank = $4, size = $5, confidence = $6, representative_note_ids = $7, metadata_json = $8::jsonb'
               : conflictClause}`,
            [set.id, community.id, community.label ?? null, community.rank ?? null, community.size ?? null, community.confidence ?? null, community.representative_note_ids ?? [], metadata],
          )
          counts.communities++
          report?.({ phase: 'communities', done: ++doneCommunities, total: totalCommunities })
          await maybeYield(doneCommunities, batchSize)
        }
      }

      for (const assignment of parsedCommunityAssignments) {
        if (await skipExisting('community_assignments', 'SELECT 1 FROM community_assignment WHERE community_set_id = $1 AND note_id = $2', [assignment.community_set_id, assignment.note_id])) {
          report?.({ phase: 'communities', done: ++doneCommunities, total: totalCommunities })
          await maybeYield(doneCommunities, batchSize)
          continue
        }
        const metadata = assignment.metadata == null ? null : JSON.stringify(assignment.metadata)
        await tx.query(
          `INSERT INTO community_assignment (community_set_id, community_id, note_id, confidence, source_type, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ${strategy === 'replace'
             ? 'ON CONFLICT (community_set_id, note_id) DO UPDATE SET community_id = $2, confidence = $4, source_type = $5, metadata_json = $6::jsonb'
             : conflictClause}`,
          [assignment.community_set_id, assignment.community_id, assignment.note_id, assignment.confidence ?? null, assignment.source_type, metadata],
        )
        counts.community_assignments++
        report?.({ phase: 'communities', done: ++doneCommunities, total: totalCommunities })
        await maybeYield(doneCommunities, batchSize)
      }

      // Import embedding set members
      report?.({ phase: 'embedding_set_members', done: 0, total: parsedEmbMembers.length })
      for (const [index, member] of parsedEmbMembers.entries()) {
        if (strategy === 'skip' && preexistingEmbeddingMembers.has(`${member.embedding_set_id}\0${member.note_id}`)) {
          skipped.embedding_set_members = (skipped.embedding_set_members ?? 0) + 1
          report?.({ phase: 'embedding_set_members', done: index + 1, total: parsedEmbMembers.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        let embeddingId = member.embedding_id ?? null
        if (!embeddingId) {
          const resolvedEmbedding = await tx.query<{ id: string }>(
            `SELECT id FROM embedding WHERE embedding_set_id = $1 AND note_id = $2 ORDER BY created_at DESC LIMIT 1`,
            [member.embedding_set_id, member.note_id],
          )
          embeddingId = resolvedEmbedding.rows[0]?.id ?? null
        }
        await tx.query(
          `INSERT INTO embedding_set_member (
             embedding_set_id, note_id, embedding_id, membership_type, added_at, added_by
           )
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (embedding_set_id, note_id) DO UPDATE SET
             embedding_id = COALESCE(EXCLUDED.embedding_id, embedding_set_member.embedding_id),
             membership_type = EXCLUDED.membership_type,
             added_at = EXCLUDED.added_at,
             added_by = EXCLUDED.added_by`,
          [
            member.embedding_set_id,
            member.note_id,
            embeddingId,
            member.membership_type ?? 'materialized',
            member.added_at ?? manifest.created_at,
            member.added_by ?? null,
          ],
        )
        counts.embedding_set_members++
        report?.({ phase: 'embedding_set_members', done: index + 1, total: parsedEmbMembers.length })
        await maybeYield(index + 1, batchSize)
      }
    })
    report?.({ phase: 'index', done: 1, total: 1 })
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
    return {
      success: false,
      counts: emptyCounts(),
      skipped,
      warnings,
      errors: [
        `Transaction failed (rolled back): ${err instanceof Error ? err.message : String(err)}${rollbackSuffix}`,
      ],
      duration_ms: performance.now() - start,
      capability_report: capabilityReport,
    }
  }

  return {
    success: true,
    counts,
    skipped,
    warnings,
    errors,
    duration_ms: performance.now() - start,
    capability_report: capabilityReport,
  }
}

// ── Parsing helpers ───────────────────────────────────────────────────────

async function resolveEmbeddingSetIdForServerEmbedding(
  db: QueryExecutor,
  model: string | null,
  vector: string,
): Promise<string> {
  // Legacy rows without a model normally carry embedding_set_id and never
  // reach this resolver; the fallback name keeps a rowless-model shard usable.
  const modelName = model ?? 'unknown'
  const dimension = vectorDimension(vector)
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM embedding_set
     WHERE model_name = $1 AND dimensions = $2
     ORDER BY created_at, id
     LIMIT 1`,
    [modelName, dimension],
  )
  if (existing.rows[0]?.id) return existing.rows[0].id

  const id = generateId()
  await db.query(
    `INSERT INTO embedding_set (
       id, name, slug, description, purpose, document_count, embedding_count,
       is_system, keywords_json, model_name, dimensions, kind, created_at, updated_at
     ) VALUES ($1, $2, $3, NULL, NULL, 0, 0, false, '[]'::jsonb, $2, $4, 'physical', now(), now())`,
    [id, modelName, slugifyServerEmbeddingSet(modelName), dimension],
  )
  return id
}

function vectorDimension(vector: string): number {
  const inner = vector.replace(/^\[/, '').replace(/\]$/, '').trim()
  if (!inner) return 0
  return inner.split(',').length
}

function slugifyServerEmbeddingSet(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'embedding-set'
}
