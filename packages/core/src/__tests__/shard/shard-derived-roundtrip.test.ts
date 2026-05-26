import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { exportShard } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { unpackTarGz } from '../../shard/shard-tar.js'
import type { ShardManifest, ShardSkosConcept, ShardProvenanceEdge } from '../../shard/types.js'

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

async function insertNote(db: PGlite, id: string): Promise<void> {
  await db.query(
    `INSERT INTO note (id, title, format, source, visibility, revision_mode)
     VALUES ($1, $2, 'markdown', 'user', 'private', 'standard')`,
    [id, id],
  )
  await db.query(
    `INSERT INTO note_original (id, note_id, content, content_hash) VALUES ($1, $2, $3, $4)`,
    [`orig-${id}`, id, `${id} original`, `hash-${id}`],
  )
  await db.query(
    `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
    [id, `${id} revised`],
  )
}

describe('shard derived structure round-trip', () => {
  it('round-trips SKOS concepts, note SKOS tags, and provenance edges', async () => {
    const db = await setupDb()
    try {
      await insertNote(db, 'note-derived-1')
      await db.query(
        `INSERT INTO skos_scheme (id, title, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        ['scheme-1', 'Research Topics', 'Controlled topics', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
      )
      await db.query(
        `INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['concept-parent', 'scheme-1', 'Machine Learning', JSON.stringify(['ML']), 'Parent topic', '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z'],
      )
      await db.query(
        `INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['concept-child', 'scheme-1', 'Embeddings', JSON.stringify(['vectors']), 'Child topic', '2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z'],
      )
      await db.query(
        `INSERT INTO skos_concept_relation (id, source_concept_id, target_concept_id, relation_type, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        ['rel-1', 'concept-child', 'concept-parent', 'broader', '2026-01-07T00:00:00.000Z'],
      )
      await db.query(
        `INSERT INTO note_skos_tag (id, note_id, concept_id, created_at) VALUES ($1, $2, $3, $4)`,
        ['note-skos-1', 'note-derived-1', 'concept-child', '2026-01-08T00:00:00.000Z'],
      )
      await db.query(
        `INSERT INTO provenance_edge (id, entity_type, entity_id, activity, agent, started_at, ended_at, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          'prov-1',
          'note',
          'note-derived-1',
          'concept_tagging',
          'llm:test',
          '2026-01-09T00:00:00.000Z',
          '2026-01-09T00:01:00.000Z',
          JSON.stringify({ confidence: 0.91, concept_id: 'concept-child' }),
        ],
      )

      const archive = await exportShard(db)
      const files = unpackTarGz(archive)
      const manifest: ShardManifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!))
      const concepts: ShardSkosConcept[] = JSON.parse(new TextDecoder().decode(files.get('skos_concepts.json')!))
      const provenance: ShardProvenanceEdge = JSON.parse(
        new TextDecoder().decode(files.get('provenance_edges.jsonl')!).trim(),
      )

      expect(manifest.components).toEqual(expect.arrayContaining([
        'skos_schemes',
        'skos_concepts',
        'skos_relations',
        'note_skos_tags',
        'provenance_edges',
      ]))
      expect(manifest.counts.skos_schemes).toBe(1)
      expect(manifest.counts.skos_concepts).toBe(2)
      expect(manifest.counts.skos_relations).toBe(1)
      expect(manifest.counts.note_skos_tags).toBe(1)
      expect(manifest.counts.provenance_edges).toBe(1)
      expect(concepts.find((concept) => concept.id === 'concept-child')?.alt_labels).toEqual(['vectors'])
      expect(provenance.attributes).toMatchObject({ confidence: 0.91, concept_id: 'concept-child' })

      const imported = await setupDb()
      try {
        const result = await importShard(imported, archive)
        expect(result.errors).toEqual([])
        expect(result.success).toBe(true)
        expect(result.counts.skos_schemes).toBe(1)
        expect(result.counts.skos_concepts).toBe(2)
        expect(result.counts.skos_relations).toBe(1)
        expect(result.counts.note_skos_tags).toBe(1)
        expect(result.counts.provenance_edges).toBe(1)

        const importedConcept = await imported.query<{ pref_label: string; alt_labels: string }>(
          `SELECT pref_label, alt_labels::text as alt_labels FROM skos_concept WHERE id = $1`,
          ['concept-child'],
        )
        const importedTag = await imported.query<{ note_id: string; concept_id: string }>(
          `SELECT note_id, concept_id FROM note_skos_tag WHERE id = $1`,
          ['note-skos-1'],
        )
        const importedProvenance = await imported.query<{ attributes: string }>(
          `SELECT attributes::text as attributes FROM provenance_edge WHERE id = $1`,
          ['prov-1'],
        )

        expect(importedConcept.rows[0].pref_label).toBe('Embeddings')
        expect(JSON.parse(importedConcept.rows[0].alt_labels)).toEqual(['vectors'])
        expect(importedTag.rows[0]).toEqual({ note_id: 'note-derived-1', concept_id: 'concept-child' })
        expect(JSON.parse(importedProvenance.rows[0].attributes)).toMatchObject({
          confidence: 0.91,
          concept_id: 'concept-child',
        })
      } finally {
        await imported.close()
      }
    } finally {
      await db.close()
    }
  }, 30000)
})
