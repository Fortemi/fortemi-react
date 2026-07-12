/**
 * Shard import pipeline — unpack, validate, field-map, transactional insert.
 *
 * Pipeline: ArrayBuffer → gunzip → untar → parse manifest → validate checksums →
 *           parse components → field-map → BEGIN transaction → INSERT all → COMMIT
 */

import type { DatabaseClient, QueryExecutor } from '../storage-backend.js'
import { unpackTarGz } from './shard-tar.js'
import { validateChecksums } from './checksum.js'
import {
  noteFromShard,
  linkFromShard,
  collectionFromShard,
  embeddingSetFromShard,
  embeddingFromShard,
} from './field-mapper.js'
import { generateId } from '../uuid.js'
import { computeHash } from '../hash.js'
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

const decoder = new TextDecoder()
const DEFAULT_BATCH_SIZE = 250

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
  const counts: ImportCounts = {
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
  const skipped: Partial<ImportCounts> = {}

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
    }
  }

  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestData))
  } catch {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: ['Invalid manifest.json: failed to parse JSON'],
      duration_ms: performance.now() - start,
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
    }
  }

  // ── Step 3: Validate checksums ────────────────────────────────────────
  report?.({ phase: 'validate', done: 0, total: 1 })
  const checksumResult = await validateChecksums(manifest.checksums, files)
  if (!checksumResult.valid) {
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: [`Checksum validation failed for: ${checksumResult.failures.join(', ')}`],
      duration_ms: performance.now() - start,
    }
  }
  report?.({ phase: 'validate', done: 1, total: 1 })

  // ── Step 4: Parse all components ──────────────────────────────────────
  // Notes may be clustered (notes/000.jsonl, …) per the manifest layout (#189);
  // a monolithic notes.jsonl is the default. Concatenate clusters in offset order.
  const noteClusters = manifest.layout?.clusters?.notes
  const parsedNotes = noteClusters && noteClusters.length > 0
    ? [...noteClusters]
        .sort((a, b) => a.offset - b.offset)
        .flatMap((ref) => parseJsonl<ShardNote>(files.get(ref.href)))
    : parseJsonl<ShardNote>(files.get('notes.jsonl'))
  const parsedCollections = parseJsonArray<ShardCollection>(files.get('collections.json'))
  // Tags are embedded in notes as arrays — the global tags.json is informational only
  parseJsonArray<ShardTag>(files.get('tags.json')) // parsed for validation, not used directly
  const parsedTemplates = parseJsonArray<ShardTemplate>(files.get('templates.json'))
  const parsedLinks = parseJsonl<ShardLink>(files.get('links.jsonl'))
  const parsedEmbSets = parseJsonArray<ShardEmbeddingSet>(files.get('embedding_sets.json'))
  const parsedEmbConfigs = parseJsonArray<ShardEmbeddingConfig>(files.get('embedding_configs.json'))
  const parsedEmbMembers = parseJsonl<ShardEmbeddingSetMember>(
    files.get('embedding_set_members.jsonl'),
  )
  const parsedEmbeddings = parseJsonl<ShardEmbedding>(files.get('embeddings.jsonl'))
  const parsedSkosSchemes = parseJsonArray<ShardSkosScheme>(files.get('skos_schemes.json'))
  const parsedSkosConcepts = parseJsonArray<ShardSkosConcept>(files.get('skos_concepts.json'))
  const parsedSkosRelations = parseJsonl<ShardSkosRelation>(files.get('skos_relations.jsonl'))
  const parsedNoteSkosTags = parseJsonl<ShardNoteSkosTag>(files.get('note_skos_tags.jsonl'))
  const parsedProvenanceEdges = parseJsonl<ShardProvenanceEdge>(files.get('provenance_edges.jsonl'))
  const parsedGraphSources = parseJsonArray<ShardGraphSource>(files.get('graph_sources.json'))
  const parsedGraphEdges = parseJsonl<ShardGraphEdge>(files.get('graph_edges.jsonl'))
  const parsedCommunitySets = parseJsonArray<ShardCommunitySet>(files.get('communities.json'))
  const parsedCommunityAssignments = parseJsonl<ShardCommunityAssignment>(files.get('community_assignments.jsonl'))

  // Warn about unknown components
  const knownFiles = new Set([
    'manifest.json',
    'notes.jsonl',
    'collections.json',
    'tags.json',
    'links.jsonl',
    'embedding_sets.json',
    'embedding_set_members.jsonl',
    'embedding_configs.json',
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
  // ── Step 5: Transactional insert ──────────────────────────────────────
  const conflictClause = strategy === 'skip' ? 'ON CONFLICT DO NOTHING' : ''

  try {
    await db.transaction(async (tx) => {
      // Import collections first (notes may reference them)
      report?.({ phase: 'collections', done: 0, total: parsedCollections.length })
      for (const [index, shardCol] of parsedCollections.entries()) {
        const col = collectionFromShard(shardCol)
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO collection (id, name, description, parent_id, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, parent_id = $4`,
            [col.id, col.name, col.description, col.parent_id, col.created_at],
          )
        } else {
          await tx.query(
            `INSERT INTO collection (id, name, description, parent_id, created_at)
             VALUES ($1, $2, $3, $4, $5) ${conflictClause}`,
            [col.id, col.name, col.description, col.parent_id, col.created_at],
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
        const contentHash = computeHash(new TextEncoder().encode(note.original_content))

        if (strategy === 'replace') {
          // Upsert note
          await tx.query(
            `INSERT INTO note (id, title, format, source, is_starred, is_archived, created_at, updated_at, deleted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET title = $2, format = $3, source = $4,
               is_starred = $5, is_archived = $6, updated_at = $8, deleted_at = $9`,
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
              `UPDATE note_original SET content = $1, content_hash = $2 WHERE note_id = $3`,
              [note.original_content, contentHash, note.id],
            )
          } else {
            await tx.query(
              `INSERT INTO note_original (id, note_id, content, content_hash) VALUES ($1, $2, $3, $4)`,
              [generateId(), note.id, note.original_content, contentHash],
            )
          }
          // Upsert current revision (note_id is PK)
          await tx.query(
            `INSERT INTO note_revised_current (note_id, content)
             VALUES ($1, $2)
             ON CONFLICT (note_id) DO UPDATE SET content = $2`,
            [note.id, note.revised_content ?? note.original_content],
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
            `INSERT INTO note_original (id, note_id, content, content_hash)
             VALUES ($1, $2, $3, $4) ${conflictClause}`,
            [generateId(), note.id, note.original_content, contentHash],
          )
          // Insert current revision
          await tx.query(
            `INSERT INTO note_revised_current (note_id, content)
             VALUES ($1, $2) ${conflictClause}`,
            [note.id, note.revised_content ?? note.original_content],
          )
        }

        // Import note tags
        for (const tag of note.tags) {
          await tx.query(
            `INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3)
             ON CONFLICT (note_id, tag) DO NOTHING`,
            [generateId(), note.id, tag],
          )
        }

        if (note.collection_id) {
          await tx.query(
            `INSERT INTO collection_note (collection_id, note_id)
             VALUES ($1, $2)
             ON CONFLICT (collection_id, note_id) DO NOTHING`,
            [note.collection_id, note.id],
          )
        }

        // Shard projections carry extracted text plus attachment metadata. They
        // intentionally do not carry the raw blob payload, so import preserves
        // the reference rows and leaves BlobStore hydration to an out-of-band
        // source that owns the bytes.
        if (note.attachments?.length) {
          notesWithImportedAttachmentReferences++
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
                [blobId, ref.checksum, ref.bytes, ref.path],
              )
            }
            const filename = ref.path.split('/').filter(Boolean).pop() ?? ref.path
            if (strategy === 'replace') {
              await tx.query(
                `INSERT INTO attachment (id, note_id, blob_id, filename, mime_type, extracted_text, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO UPDATE SET
                   note_id = $2,
                   blob_id = $3,
                   filename = $4,
                   mime_type = $5,
                   extracted_text = $6,
                   position = $7,
                   deleted_at = NULL`,
                [ref.id, note.id, blobId, filename, ref.mime, projection.extracted_text, position],
              )
            } else {
              await tx.query(
                `INSERT INTO attachment (id, note_id, blob_id, filename, mime_type, extracted_text, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) ${conflictClause}`,
                [ref.id, note.id, blobId, filename, ref.mime, projection.extracted_text, position],
              )
            }
            importedAttachmentReferenceCount++
          }
        }

        counts.notes++
        report?.({ phase: 'notes', done: index + 1, total: parsedNotes.length })
        await maybeYield(index + 1, batchSize)
      }

      if (importedAttachmentReferenceCount > 0) {
        warnings.push(
          `${importedAttachmentReferenceCount} attachment reference(s) across ${notesWithImportedAttachmentReferences} note(s) were imported as metadata only: ` +
            'Knowledge Shard projections carry extracted text plus attachment metadata, not raw binary payloads, ' +
            'so BlobStore bytes remain unavailable unless provided by an out-of-band attachment source. Tracking: #237 / server #1013.',
        )
      }

      // Import SKOS schemes and concepts before note concept assignments.
      const totalSkos = parsedSkosSchemes.length + parsedSkosConcepts.length + parsedSkosRelations.length + parsedNoteSkosTags.length
      let doneSkos = 0
      report?.({ phase: 'skos', done: doneSkos, total: totalSkos })
      for (const scheme of parsedSkosSchemes) {
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
          await tx.query(
            `INSERT INTO link_url_target (
               id, source_note_id, to_url, link_type, confidence, metadata_json, created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
             ${strategy === 'replace'
               ? 'ON CONFLICT (id) DO UPDATE SET source_note_id = $2, to_url = $3, link_type = $4, confidence = $5, metadata_json = $6::jsonb, created_at = $7'
               : conflictClause}`,
            [link.id, link.source_note_id, link.to_url, link.link_type, link.confidence, metadata, link.created_at],
          )
          counts.links++
          report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
          await maybeYield(index + 1, batchSize)
          continue
        }
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO link (id, source_note_id, target_note_id, link_type, confidence, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET link_type = $4, confidence = $5`,
            [link.id, link.source_note_id, link.target_note_id, link.link_type, link.confidence, link.created_at],
          )
        } else {
          await tx.query(
            `INSERT INTO link (id, source_note_id, target_note_id, link_type, confidence, created_at)
             VALUES ($1, $2, $3, $4, $5, $6) ${conflictClause}`,
            [link.id, link.source_note_id, link.target_note_id, link.link_type, link.confidence, link.created_at],
          )
        }
        counts.links++
        report?.({ phase: 'links', done: index + 1, total: parsedLinks.length })
        await maybeYield(index + 1, batchSize)
      }

      // Import SKOS relations and note assignments after concepts and notes.
      for (const relation of parsedSkosRelations) {
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
        await tx.query(
          `INSERT INTO community_set (id, graph_source_id, name, source_type, algorithm, parameters_json, input_hash, freshness_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
           ${strategy === 'replace'
             ? 'ON CONFLICT (id) DO UPDATE SET graph_source_id = $2, name = $3, source_type = $4, algorithm = $5, parameters_json = $6::jsonb, input_hash = $7, freshness_json = $8::jsonb, created_at = $9'
             : conflictClause}`,
          [set.id, set.graph_source_id, set.name, set.source_type, set.algorithm ?? null, parameters, set.input_hash, freshness, set.created_at],
        )
        counts.community_sets++
        report?.({ phase: 'communities', done: ++doneCommunities, total: totalCommunities })
        await maybeYield(doneCommunities, batchSize)

        for (const community of set.communities ?? []) {
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
    return {
      success: false,
      counts,
      skipped,
      warnings,
      errors: [`Transaction failed (rolled back): ${err instanceof Error ? err.message : String(err)}`],
      duration_ms: performance.now() - start,
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

// ── Parsing helpers ───────────────────────────────────────────────────────

async function resolveEmbeddingSetIdForServerEmbedding(
  db: QueryExecutor,
  model: string,
  vector: string,
): Promise<string> {
  const dimension = vectorDimension(vector)
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM embedding_set
     WHERE model_name = $1 AND dimensions = $2
     ORDER BY created_at, id
     LIMIT 1`,
    [model, dimension],
  )
  if (existing.rows[0]?.id) return existing.rows[0].id

  const id = generateId()
  await db.query(
    `INSERT INTO embedding_set (
       id, name, slug, description, purpose, document_count, embedding_count,
       is_system, keywords_json, model_name, dimensions, kind, created_at, updated_at
     ) VALUES ($1, $2, $3, NULL, NULL, 0, 0, false, '[]'::jsonb, $2, $4, 'physical', now(), now())`,
    [id, model, slugifyServerEmbeddingSet(model), dimension],
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

function parseJsonl<T>(data: Uint8Array | undefined): T[] {
  if (!data || data.byteLength === 0) return []
  const text = decoder.decode(data)
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T)
}

function parseJsonArray<T>(data: Uint8Array | undefined): T[] {
  if (!data || data.byteLength === 0) return []
  return JSON.parse(decoder.decode(data)) as T[]
}
