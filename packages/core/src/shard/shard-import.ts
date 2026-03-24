/**
 * Shard import pipeline — unpack, validate, field-map, transactional insert.
 *
 * Pipeline: ArrayBuffer → gunzip → untar → parse manifest → validate checksums →
 *           parse components → field-map → BEGIN transaction → INSERT all → COMMIT
 */

import type { PGlite } from '@electric-sql/pglite'
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
import { CURRENT_SHARD_VERSION } from './types.js'
import type {
  ShardManifest,
  ImportOptions,
  ImportResult,
  ImportCounts,
  ShardNote,
  ShardLink,
  ShardCollection,
  ShardTag,
  ShardEmbeddingSet,
  ShardEmbeddingSetMember,
  ShardEmbedding,
} from './types.js'

const decoder = new TextDecoder()

/**
 * Import a .shard archive into the database.
 *
 * The entire import is wrapped in a single transaction — if anything fails,
 * all changes are rolled back.
 *
 * @param db PGlite database instance
 * @param data Raw archive bytes (from File API or fetch)
 * @param options Import options (conflict strategy)
 * @returns Import result with counts, warnings, and errors
 */
export async function importShard(
  db: PGlite,
  data: Uint8Array | ArrayBuffer,
  options?: ImportOptions,
): Promise<ImportResult> {
  const start = performance.now()
  const strategy = options?.conflictStrategy ?? 'skip'
  const warnings: string[] = []
  const errors: string[] = []
  const counts: ImportCounts = {
    notes: 0,
    collections: 0,
    tags: 0,
    links: 0,
    embedding_sets: 0,
    embedding_set_members: 0,
    embeddings: 0,
  }
  const skipped: Partial<ImportCounts> = {}

  const inputData = data instanceof ArrayBuffer ? new Uint8Array(data) : data

  // ── Step 1: Unpack tar.gz ─────────────────────────────────────────────
  let files: Map<string, Uint8Array>
  try {
    files = unpackTarGz(inputData)
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
  if (manifest.min_reader_version && manifest.min_reader_version > CURRENT_SHARD_VERSION) {
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

  // ── Step 4: Parse all components ──────────────────────────────────────
  const parsedNotes = parseJsonl<ShardNote>(files.get('notes.jsonl'))
  const parsedCollections = parseJsonArray<ShardCollection>(files.get('collections.json'))
  // Tags are embedded in notes as arrays — the global tags.json is informational only
  parseJsonArray<ShardTag>(files.get('tags.json')) // parsed for validation, not used directly
  const parsedLinks = parseJsonl<ShardLink>(files.get('links.jsonl'))
  const parsedEmbSets = parseJsonArray<ShardEmbeddingSet>(files.get('embedding_sets.json'))
  const parsedEmbMembers = parseJsonl<ShardEmbeddingSetMember>(
    files.get('embedding_set_members.jsonl'),
  )
  const parsedEmbeddings = parseJsonl<ShardEmbedding>(files.get('embeddings.jsonl'))

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
  ])
  for (const filename of files.keys()) {
    if (!knownFiles.has(filename)) {
      warnings.push(`Unknown component skipped: ${filename}`)
    }
  }
  if (files.has('templates.json')) {
    warnings.push('templates.json skipped (not supported in browser)')
  }

  // ── Step 5: Transactional insert ──────────────────────────────────────
  const conflictClause = strategy === 'skip' ? 'ON CONFLICT DO NOTHING' : ''

  try {
    await db.transaction(async (tx) => {
      // Import collections first (notes may reference them)
      for (const shardCol of parsedCollections) {
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
      }

      // Import notes
      for (const shardNote of parsedNotes) {
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

        counts.notes++
      }

      // Import links
      for (const shardLink of parsedLinks) {
        const link = linkFromShard(shardLink)
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
      }

      // Import embedding sets
      for (const shardSet of parsedEmbSets) {
        const set = embeddingSetFromShard(shardSet)
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO embedding_set (id, model_name, dimensions, created_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET model_name = $2, dimensions = $3`,
            [set.id, set.model_name, set.dimensions, set.created_at],
          )
        } else {
          await tx.query(
            `INSERT INTO embedding_set (id, model_name, dimensions, created_at)
             VALUES ($1, $2, $3, $4) ${conflictClause}`,
            [set.id, set.model_name, set.dimensions, set.created_at],
          )
        }
        counts.embedding_sets++
      }

      // Import embeddings
      for (const shardEmb of parsedEmbeddings) {
        const emb = embeddingFromShard(shardEmb)
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO embedding (id, note_id, embedding_set_id, vector, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET vector = $4`,
            [emb.id, emb.note_id, emb.embedding_set_id, emb.vector, emb.created_at],
          )
        } else {
          await tx.query(
            `INSERT INTO embedding (id, note_id, embedding_set_id, vector, created_at)
             VALUES ($1, $2, $3, $4, $5) ${conflictClause}`,
            [emb.id, emb.note_id, emb.embedding_set_id, emb.vector, emb.created_at],
          )
        }
        counts.embeddings++
      }

      // Import embedding set members
      for (const member of parsedEmbMembers) {
        await tx.query(
          `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [member.embedding_set_id, member.note_id, member.embedding_id],
        )
        counts.embedding_set_members++
      }
    })
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
