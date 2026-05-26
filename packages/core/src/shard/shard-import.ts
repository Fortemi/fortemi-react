/**
 * Shard import pipeline — unpack, validate, field-map, transactional insert.
 *
 * Pipeline: ArrayBuffer → gunzip → untar → parse manifest → validate checksums →
 *           parse components → field-map → BEGIN transaction → INSERT all → COMMIT
 */

import type { DatabaseClient } from '../storage-backend.js'
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

      // Import SKOS schemes and concepts before note concept assignments.
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
      }

      for (const tag of parsedNoteSkosTags) {
        await tx.query(
          `INSERT INTO note_skos_tag (id, note_id, concept_id, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (note_id, concept_id) DO NOTHING`,
          [tag.id, tag.note_id, tag.concept_id, tag.created_at],
        )
        counts.note_skos_tags++
      }

      // Import provenance edges.
      for (const edge of parsedProvenanceEdges) {
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
      }

      // Import embedding sets
      for (const shardSet of parsedEmbSets) {
        const set = embeddingSetFromShard(shardSet)
        if (strategy === 'replace') {
          await tx.query(
            `INSERT INTO embedding_set (
               id, name, purpose, model_name, dimensions, kind, mode, truncate_dimension,
               criteria_json, source_json, compatibility_json, materialization_json, freshness_json, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, COALESCE($15::timestamptz, $14::timestamptz))
             ON CONFLICT (id) DO UPDATE SET name = $2, purpose = $3, model_name = $4, dimensions = $5,
               kind = $6, mode = $7, truncate_dimension = $8, criteria_json = $9::jsonb, source_json = $10::jsonb,
               compatibility_json = $11::jsonb, materialization_json = $12::jsonb, freshness_json = $13::jsonb, updated_at = COALESCE($15::timestamptz, $14::timestamptz)`,
            [set.id, set.name, set.purpose, set.model_name, set.dimensions, set.kind, set.mode, set.truncate_dimension, set.criteria_json, set.source_json, set.compatibility_json, set.materialization_json, set.freshness_json, set.created_at, set.updated_at],
          )
        } else {
          await tx.query(
            `INSERT INTO embedding_set (
               id, name, purpose, model_name, dimensions, kind, mode, truncate_dimension,
               criteria_json, source_json, compatibility_json, materialization_json, freshness_json, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, COALESCE($15::timestamptz, $14::timestamptz)) ${conflictClause}`,
            [set.id, set.name, set.purpose, set.model_name, set.dimensions, set.kind, set.mode, set.truncate_dimension, set.criteria_json, set.source_json, set.compatibility_json, set.materialization_json, set.freshness_json, set.created_at, set.updated_at],
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



      // Import graph/community artifacts after primary graph inputs exist.
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
      }

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
