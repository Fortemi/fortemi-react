import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { LinksRepository } from '../../repositories/links-repository.js'
import { exportShard } from '../../shard/shard-export.js'
import {
  assertShardComponentRecord,
  getKnowledgeShardSchema,
  validateShardArchive,
  validateShardComponentRecord,
  validateShardManifest,
} from '../../shard/schema-validator.js'

const iso = '2026-07-09T00:00:00.000Z'
const testDir = fileURLToPath(new URL('.', import.meta.url))
const goldenFixturePath = resolve(
  testDir,
  'fixtures/golden/server-2026.2.9-fortemi-docs.shard',
)
const goldenReceiptPath = `${goldenFixturePath}.receipt.json`

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

describe('knowledge shard AJV schema validator (#255)', () => {
  it('compiles the committed schema and validates a manifest', () => {
    expect(getKnowledgeShardSchema()).toBeTruthy()
    const result = validateShardManifest({
      version: '1.0.0',
      matric_version: '2026.7.3',
      format: 'matric-shard',
      created_at: iso,
      components: ['notes', 'collections', 'tags', 'templates', 'links'],
      counts: { notes: 1, collections: 0, tags: 0, templates: 0, links: 0 },
      checksums: { 'notes.jsonl': 'a'.repeat(64) },
      min_reader_version: '1.0.0',
      migrated_from: null,
      migration_history: [],
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('validates server manifest migration metadata', () => {
    const result = validateShardManifest({
      version: '1.1.0',
      matric_version: '2026.2.0',
      format: 'matric-shard',
      created_at: '2026-02-01T12:00:00Z',
      components: ['notes', 'embeddings'],
      counts: { notes: 10, embeddings: 10 },
      checksums: { 'notes.jsonl': 'b'.repeat(64), 'embeddings.jsonl': 'c'.repeat(64) },
      min_reader_version: '2026.1.0',
      migrated_from: '1.0.0',
      migration_history: [
        {
          from_version: '1.0.0',
          to_version: '1.1.0',
          migrated_at: '2026-02-01T12:00:00Z',
          migrated_by: 'matric-memory/2026.2.0',
          changes: ['Added MRL embedding support with truncate_dim field'],
        },
      ],
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('validates a server-contract note record with attachments and collection_id', () => {
    const result = validateShardComponentRecord('notes', {
      id: 'note-1',
      title: 'Note',
      original_content: 'original',
      revised_content: null,
      collection_id: 'collection-1',
      attachments: [
        {
          extracted_text: 'ocr text',
          attachment: {
            id: 'att-1',
            path: 'scan.pdf',
            mime: 'application/pdf',
            checksum: 'sha256:' + 'b'.repeat(64),
            bytes: 123,
          },
        },
      ],
      format: 'markdown',
      source: 'manual',
      starred: false,
      archived: false,
      tags: ['research'],
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('allows pending attachment extraction records to carry null extracted_text', () => {
    const result = validateShardComponentRecord('notes', {
      id: 'note-1',
      title: 'Note',
      original_content: 'original',
      revised_content: null,
      collection_id: null,
      attachments: [
        {
          extracted_text: null,
          attachment: {
            id: 'att-1',
            path: 'video.mp4',
            mime: 'video/mp4',
            checksum: 'sha256:' + 'c'.repeat(64),
            bytes: 1024,
          },
        },
      ],
      format: 'markdown',
      source: 'manual',
      starred: false,
      archived: false,
      tags: [],
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('validates a real React-exported shard archive for aligned components', async () => {
    const db = await createTestDb()
    try {
      const notes = new NotesRepository(db)
      const links = new LinksRepository(db)
      const first = await notes.create({ content: 'First note', title: 'First', tags: ['alpha'] })
      const second = await notes.create({ content: 'Second note', title: 'Second', tags: ['beta'] })
      await links.create(first.id, second.id, 'related')

      const archive = await exportShard(db)
      const result = validateShardArchive(archive)

      expect(result).toEqual({ valid: true, errors: [] })
    } finally {
      await db.close()
    }
  }, 30_000)

  it('validates the committed pinned server golden shard fixture', () => {
    const bytes = readFileSync(goldenFixturePath)
    const receipt = JSON.parse(readFileSync(goldenReceiptPath, 'utf8')) as {
      bytes: number
      sha256: string
      pinned_version: string
    }

    expect(receipt.pinned_version).toBe('2026.2.9')
    expect(receipt.bytes).toBe(bytes.byteLength)
    expect(receipt.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(validateShardArchive(bytes)).toEqual({ valid: true, errors: [] })
  })

  it('rejects legacy binary_sources and missing server fields', () => {
    const result = validateShardComponentRecord('notes', {
      id: 'note-1',
      title: 'Note',
      original_content: 'original',
      revised_content: null,
      binary_sources: [],
      format: 'markdown',
      source: 'manual',
      starred: false,
      archived: false,
      tags: [],
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    })

    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('must NOT have additional properties')
  })

  it('validates all declared component record schemas', () => {
    const samples = [
      ['collections', { id: 'col-1', name: 'Research', description: null, parent_id: null, created_at: iso, note_count: 0 }],
      ['tags', { name: 'tag', created_at: iso }],
      ['templates', { id: 'tmpl-1', name: 'Template', description: null, content: 'Body', format: 'markdown', default_tags: [], collection_id: null, created_at: iso, updated_at: iso }],
      ['links', { id: 'link-1', from_note_id: 'note-1', to_note_id: null, to_url: 'https://example.test', kind: 'reference', score: null, created_at: iso, metadata: null }],
      ['embedding_sets', { id: 'set-1', name: 'Default', slug: 'default', description: null, purpose: null, document_count: 0, embedding_count: 0, is_system: false, keywords: [], model: 'test-model', dimension: 384 }],
      ['embedding_set_members', { embedding_set_id: 'set-1', note_id: 'note-1', membership_type: 'manual', added_at: iso, added_by: null }],
      ['embedding_configs', { id: 'cfg-1', name: 'Default', description: null, model: 'test-model', dimension: 384, chunk_size: 512, chunk_overlap: 64, is_default: true }],
      ['embeddings', { id: 'emb-1', note_id: 'note-1', chunk_index: 0, text: 'chunk', vector: [0.1, 0.2], model: 'test-model' }],
      ['skos_schemes', { id: 'scheme-1', title: 'Scheme', description: null, created_at: iso, updated_at: iso }],
      ['skos_concepts', { id: 'concept-1', scheme_id: 'scheme-1', pref_label: 'Concept', alt_labels: [], definition: null, created_at: iso, updated_at: iso }],
      ['skos_relations', { id: 'rel-1', source_concept_id: 'concept-1', target_concept_id: 'concept-2', relation_type: 'related', created_at: iso }],
      ['note_skos_tags', { id: 'nst-1', note_id: 'note-1', concept_id: 'concept-1', created_at: iso }],
      ['provenance_edges', { id: 'prov-1', entity_type: 'note', entity_id: 'note-1', activity: 'import', agent: 'test', started_at: iso, ended_at: null, attributes: null }],
      ['graph_sources', { id: 'graph-1', name: 'Graph', kind: 'manual', input_hash: 'hash', freshness: { status: 'unknown' }, created_at: iso }],
      ['graph_edges', { graph_source_id: 'graph-1', from_note_id: 'note-1', to_note_id: 'note-2', weight: 1, kind: 'manual' }],
      ['communities', { id: 'set-1', graph_source_id: 'graph-1', name: 'Communities', source_type: 'precomputed', input_hash: 'hash', freshness: { status: 'unknown' }, communities: [{ id: 'community-1' }], created_at: iso }],
      ['community_assignments', { community_set_id: 'set-1', community_id: 'community-1', note_id: 'note-1', source_type: 'precomputed' }],
    ] as const

    for (const [component, sample] of samples) {
      expect(validateShardComponentRecord(component, sample), component).toEqual({ valid: true, errors: [] })
      expect(() => assertShardComponentRecord(component, sample)).not.toThrow()
    }
  })
})
