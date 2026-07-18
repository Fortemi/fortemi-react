/**
 * @source @packages/core/src/shard/schema-validator.ts
 * @requirement @.aiwg/adrs/ADR-010-portable-schema-topology-and-source-of-truth.md
 * @requirement @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @created 2026-07-17
 * @agent Codex
 */
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
  getKnowledgeShardContractReceipt,
  getKnowledgeShardSchema,
  validateCoreV1ShardArchive,
  validateRecordV1ShardArchive,
  validateShardArchive,
  validateShardComponentRecord,
  validateShardManifest,
} from '../../shard/schema-validator.js'

const iso = '2026-07-09T00:00:00.000Z'
const testDir = fileURLToPath(new URL('.', import.meta.url))
const goldenFixturePath = resolve(
  testDir,
  'fixtures/golden/server-2026.7.1-fortemi-docs.shard',
)
const goldenReceiptPath = `${goldenFixturePath}.receipt.json`
const canonicalFixtureRoot = resolve(testDir, 'fixtures/canonical-core-v1')
const historicalCanonicalFixtureRoot = resolve(
  testDir,
  'fixtures/canonical-core-v1-v1.0',
)
const recordCanonicalFixtureRoot = resolve(testDir, 'fixtures/canonical-record-v1')
const canonicalFixtureNames = [
  'manifest.json',
  'notes.jsonl',
  'collections.json',
  'tags.json',
  'templates.json',
  'links.jsonl',
] as const
const recordCanonicalFixtureNames = [
  'manifest.json',
  'notes.jsonl',
  'collections.json',
  'tags.json',
  'links.jsonl',
] as const

function canonicalCoreV1Files(): Map<string, Uint8Array> {
  return new Map(
    canonicalFixtureNames.map((name) => [name, readFileSync(resolve(canonicalFixtureRoot, name))]),
  )
}

function historicalCanonicalCoreV1Files(): Map<string, Uint8Array> {
  return new Map(
    canonicalFixtureNames.map((name) => [
      name,
      readFileSync(resolve(historicalCanonicalFixtureRoot, name)),
    ]),
  )
}

function canonicalRecordV1Files(): Map<string, Uint8Array> {
  return new Map(
    recordCanonicalFixtureNames.map((name) => [
      name,
      readFileSync(resolve(recordCanonicalFixtureRoot, name)),
    ]),
  )
}

function canonicalNote(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(canonicalFixtureRoot, 'notes.jsonl'), 'utf8'),
  ) as Record<string, unknown>
}

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

describe('knowledge shard AJV schema validator (#255)', () => {
  it('pins the exact Fortemi 1.1.0 core-v1 authority and historical receipt', () => {
    const receipt = getKnowledgeShardContractReceipt() as {
      source: { repository: string; commit: string; contractPath: string; contractSha256: string }
      schemaBundle: { sha256: string }
      goldenCorpus: { sha256: string }
      recordV1GoldenCorpus: { sha256: string }
      historicalReleases: {
        '1.0.0/core-v1': {
          migrationTo: string
          schemaBundle: { sha256: string }
          goldenCorpus: { sha256: string }
        }
      }
    }

    expect(receipt.source).toEqual({
      repository: 'https://git.integrolabs.net/Fortemi/fortemi',
      commit: 'b5faad1dafac8346a0b6c06316c83776f5ebb47f',
      contractPath: 'contracts/knowledge-shard/contract.json',
      contractSha256: '702ace1961cbbbdb88b01ba7137227dbfa81a7fd4f7bc9392d295c602469ef00',
    })
    expect(receipt.schemaBundle.sha256).toBe(
      '2963063ea7b332c0fdc7d00463f2775f05886d822a89b6422992206e8c111362',
    )
    expect(receipt.goldenCorpus.sha256).toBe(
      '7b19ec48e1d5dbf73e7664d7853fafa86227fc042f85c02ada6bbf75941de164',
    )
    expect(receipt.recordV1GoldenCorpus.sha256).toBe(
      '76ad7cdeba3c5935ca39a32044609b0cc826862145910f8450b0d2b5fc128a19',
    )
    expect(receipt.historicalReleases['1.0.0/core-v1']).toMatchObject({
      migrationTo: '1.1.0',
    })
    expect(receipt.historicalReleases['1.0.0/core-v1'].schemaBundle.sha256).toBe(
      '2520ba0b3a8a020f5c540e88fd31233c7ddbe0d343d1e6a884ed689c8e1d3710',
    )
    expect(receipt.historicalReleases['1.0.0/core-v1'].goldenCorpus.sha256).toBe(
      '7e8c529b7f5ac404d27302499c74470e137b03d27fce54111acf8989b1147ae1',
    )
  })

  it('validates the exact Fortemi core-v1 golden corpus and checksums', async () => {
    const files = canonicalCoreV1Files()

    expect(validateShardArchive(files)).toEqual({ valid: true, errors: [] })
    await expect(validateCoreV1ShardArchive(files)).resolves.toEqual({
      valid: true,
      errors: [],
    })
  })

  it('retains exact validation for the immutable Fortemi 1.0.0 corpus', async () => {
    const files = historicalCanonicalCoreV1Files()

    expect(validateShardArchive(files)).toEqual({ valid: true, errors: [] })
    await expect(validateCoreV1ShardArchive(files)).resolves.toEqual({
      valid: true,
      errors: [],
    })
  })

  it('validates the exact supported Fortemi record-v1 corpus and checksums', async () => {
    const files = canonicalRecordV1Files()

    expect(validateShardArchive(files)).toEqual({ valid: true, errors: [] })
    await expect(validateRecordV1ShardArchive(files)).resolves.toEqual({
      valid: true,
      errors: [],
    })
  })

  it('enforces canonical UUID, timestamp, attachment digest, and URI formats', () => {
    const valid = canonicalNote()
    for (const [path, value] of [
      ['id', 'not-a-uuid'],
      ['created_at', 'not-a-timestamp'],
      ['deleted_at', 'not-a-timestamp'],
    ] as const) {
      const invalid = structuredClone(valid)
      invalid[path] = value
      expect(validateShardComponentRecord('notes', invalid, 'core-v1').valid, path).toBe(false)
    }

    const tombstone = structuredClone(valid)
    tombstone.deleted_at = '2026-07-18T00:00:00Z'
    expect(validateShardComponentRecord('notes', tombstone, 'core-v1')).toEqual({
      valid: true,
      errors: [],
    })

    const invalidDigest = structuredClone(valid)
    const attachments = invalidDigest.attachments as Array<{
      attachment: { checksum: string }
    }>
    attachments[0].attachment.checksum = `sha256:${'0'.repeat(64)}`
    expect(validateShardComponentRecord('notes', invalidDigest, 'core-v1').valid).toBe(false)

    const invalidLink = {
      id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77e',
      from_note_id: valid.id,
      to_note_id: null,
      to_url: 'not a URI',
      kind: 'reference',
      score: 1,
      created_at: valid.created_at,
      metadata: null,
    }
    expect(validateShardComponentRecord('links', invalidLink, 'core-v1').valid).toBe(false)
  })

  it('rejects core-v1 count, file, reference, and checksum drift', async () => {
    const countDrift = canonicalCoreV1Files()
    const countManifest = JSON.parse(new TextDecoder().decode(countDrift.get('manifest.json'))) as {
      counts: { notes: number }
    }
    countManifest.counts.notes += 1
    countDrift.set('manifest.json', new TextEncoder().encode(JSON.stringify(countManifest)))
    expect(validateShardArchive(countDrift).errors.join('\n')).toContain('count mismatch')

    const unknownFile = canonicalCoreV1Files()
    unknownFile.set('unexpected.json', new TextEncoder().encode('{}'))
    expect(validateShardArchive(unknownFile).errors.join('\n')).toContain(
      'archive contains undeclared file unexpected.json',
    )

    const brokenReference = canonicalCoreV1Files()
    const note = canonicalNote()
    note.collection_id = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e700'
    brokenReference.set('notes.jsonl', new TextEncoder().encode(JSON.stringify(note)))
    expect(validateShardArchive(brokenReference).errors.join('\n')).toContain(
      'collection_id does not reference a declared collection',
    )

    const checksumDrift = canonicalCoreV1Files()
    const notes = checksumDrift.get('notes.jsonl')!
    const padded = new Uint8Array(notes.byteLength + 1)
    padded.set(notes)
    padded[notes.byteLength] = 0x0a
    checksumDrift.set('notes.jsonl', padded)
    expect((await validateCoreV1ShardArchive(checksumDrift)).errors.join('\n')).toContain(
      'notes.jsonl checksum mismatch',
    )
  })

  it('rejects record-v1 schema, reference, and checksum drift', async () => {
    const nullScore = canonicalRecordV1Files()
    const link = JSON.parse(
      new TextDecoder().decode(nullScore.get('links.jsonl')),
    ) as Record<string, unknown>
    link.score = null
    nullScore.set('links.jsonl', new TextEncoder().encode(JSON.stringify(link)))
    expect(validateShardArchive(nullScore).errors.join('\n')).toContain(
      'links.jsonl[0] /score must be number',
    )

    const missingTarget = canonicalRecordV1Files()
    const brokenLink = JSON.parse(
      new TextDecoder().decode(missingTarget.get('links.jsonl')),
    ) as Record<string, unknown>
    brokenLink.to_note_id = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e700'
    missingTarget.set('links.jsonl', new TextEncoder().encode(JSON.stringify(brokenLink)))
    expect(validateShardArchive(missingTarget).errors.join('\n')).toContain(
      'to_note_id does not reference a declared note',
    )

    const checksumDrift = canonicalRecordV1Files()
    checksumDrift.set('tags.json', new TextEncoder().encode('[]'))
    expect((await validateRecordV1ShardArchive(checksumDrift)).errors.join('\n')).toContain(
      'tags.json count mismatch',
    )
  })

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

    expect(receipt.pinned_version).toBe('2026.7.1')
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

  it('accepts legacy React embedding rows without chunk_index/text/model (#344)', () => {
    const legacy = {
      id: 'emb-legacy-1',
      note_id: 'note-1',
      embedding_set_id: 'set-1',
      vector: [0.1, 0.2],
      created_at: iso,
    }
    expect(validateShardComponentRecord('embeddings', legacy)).toEqual({ valid: true, errors: [] })
  })
})
