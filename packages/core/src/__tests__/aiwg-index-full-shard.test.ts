import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { describe, expect, it } from 'vitest'
import type { AiwgFortemiIndexExport, AiwgFortemiRecord } from '../aiwg-index.js'
import { aiwgFortemiIndexToKnowledgeShardWithReport } from '../aiwg-index-shard.js'
import { MemoryBlobStore } from '../blob-store.js'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { exportShardWithReport } from '../shard/shard-export.js'
import { importShard } from '../shard/shard-import.js'
import { validateFullV1ShardArchive } from '../shard/schema-validator.js'
import { unpackTarGz } from '../shard/shard-tar.js'

const decoder = new TextDecoder()

function sourceRecord(id: string, overrides: Partial<AiwgFortemiRecord> = {}): AiwgFortemiRecord {
  return {
    schema_version: 'aiwg.fortemi.index.record.v2',
    id,
    type: 'aiwg.artifact',
    source: {
      path: `${id}.md`, repo_relative_path: `${id}.md`, locator: id,
      updated_at: '2026-07-22T12:00:00.000Z',
    },
    title: id,
    text: `${id} body`,
    facets: {},
    tags: ['portable'],
    concepts: [],
    relationships: [],
    provenance: [{
      field: 'text', source: `${id}.md`, path: '$.text',
      confidence: 'source', privacy: 'public',
    }],
    privacy: { classification: 'public', pii: false },
    updated_at: '2026-07-22T12:00:00.000Z',
    ...overrides,
  }
}

function sourceIndex(): AiwgFortemiIndexExport {
  return {
    schema_version: 'aiwg.fortemi.index.export.v2',
    generated_at: '2026-07-22T12:00:00.000Z',
    source: { repo: 'Fortemi/aiwg', privacy: 'public', graph: 'project' },
    compatibility: { previous_schema_version: 'aiwg.fortemi.index.export.v1', strategy: 'supported' },
    items: [
      sourceRecord('aiwg:a', {
        title: '',
        text: '',
        concepts: ['concept:portable'],
        relationships: [{ type: 'uses', target_id: 'aiwg:b', confidence: 0.75 }],
        skos_concepts: [{
          id: 'concept:portable', prefLabel: 'Portable', scheme: 'aiwg',
          definition: 'Portable knowledge.', altLabels: ['Transferable'],
        }],
        provenance_events: [{
          id: 'event:a', activity: 'indexed', agent: 'aiwg',
          started_at: '2026-07-22T11:00:00.000Z', attributes: { pass: true },
        }],
        embeddings: [{ id: 'embedding:a', model: 'fixture-768', vector: Array(768).fill(0.25) }],
      }),
      sourceRecord('aiwg:b', { concepts: ['concept:portable'] }),
    ],
  }
}

async function createDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

describe('AIWG 2.0.0/full-v1 converter (#381)', () => {
  it('verifies the committed source, implementation, archive, and authority receipt', async () => {
    const base = new URL('./shard/fixtures/aiwg-full-v1/', import.meta.url)
    const sourceBytes = readFileSync(new URL('aiwg-index-v2.json', base))
    const implementationBytes = readFileSync(new URL('../aiwg-index-full-shard.ts', import.meta.url))
    const archive = new Uint8Array(readFileSync(new URL('aiwg-full-v1.shard', base)))
    const receipt = JSON.parse(readFileSync(
      new URL('aiwg-full-v1.shard.receipt.json', base), 'utf8',
    )) as {
      source: { sha256: string }
      implementation: { sha256: string }
      archive: { bytes: number; sha256: string }
      conversion: { manifest_sha256: string }
    }
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    expect(digest(sourceBytes)).toBe(receipt.source.sha256)
    expect(digest(implementationBytes)).toBe(receipt.implementation.sha256)
    expect(archive.byteLength).toBe(receipt.archive.bytes)
    expect(digest(archive)).toBe(receipt.archive.sha256)
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)

    const regenerated = await aiwgFortemiIndexToKnowledgeShardWithReport(
      JSON.parse(sourceBytes.toString('utf8')) as AiwgFortemiIndexExport,
      { createdAt: '2026-07-22T12:00:00.000Z', matricVersion: '2026.7.13-candidate' },
    )
    expect(regenerated.success).toBe(true)
    expect(regenerated.archive).toEqual(archive)
    expect(regenerated.receipt.manifest_sha256).toBe(receipt.conversion.manifest_sha256)
  })

  it('emits deterministic native components for a lossless source', async () => {
    const first = await aiwgFortemiIndexToKnowledgeShardWithReport(sourceIndex(), {
      createdAt: '2026-07-22T12:00:00.000Z', matricVersion: '2026.7.13-test',
    })
    const second = await aiwgFortemiIndexToKnowledgeShardWithReport(sourceIndex(), {
      createdAt: '2026-07-22T12:00:00.000Z', matricVersion: '2026.7.13-test',
    })
    expect(first.archive).toEqual(second.archive)
    expect(first.receipt).toEqual(second.receipt)
    expect(first.success).toBe(true)
    expect(first.lossless).toBe(true)
    expect(first.losses).toEqual([])
    expect(first.receipt).toMatchObject({
      authority_commit: '6343bd899958445bbc7e7e87b0dc92a8429d5a06',
      authority_schema_bundle_sha256: '66dee80876c73fdc8756541c72e96ae189c098113a831c849d619381c4121c02',
      contract_valid: true,
      signed: false,
    })
    const files = unpackTarGz(first.archive!)
    expect((await validateFullV1ShardArchive(files)).valid).toBe(true)
    const manifest = JSON.parse(decoder.decode(files.get('manifest.json'))) as {
      version: string; profile: string; components: string[]; counts: Record<string, number>
    }
    expect(manifest).toMatchObject({ version: '2.0.0', profile: 'full-v1' })
    expect(manifest.components).toHaveLength(33)
    expect(manifest.counts).toMatchObject({
      notes: 2, links: 1, note_originals: 2, note_revised_current: 2,
      embeddings: 1, skos_concepts: 1, skos_labels: 2,
      note_skos_tags: 2, provenance_activities: 3,
      graph_sources: 1, graph_edges: 1,
    })
    const note = JSON.parse(decoder.decode(files.get('notes.jsonl')).split('\n')[0]) as {
      title: string; original_content: string; metadata: Record<string, unknown>
    }
    expect(note.title).toBe('')
    expect(note.original_content).toBe('')
    expect(JSON.stringify(note.metadata)).not.toContain('skos_concepts')
    expect(JSON.parse(decoder.decode(files.get('skos_concepts.json')))).toHaveLength(1)
  })

  it('fails closed with machine losses when full-v1 would omit source information', async () => {
    const source = sourceIndex()
    source.items[0].binary_sources = [{
      extracted_text: null,
      attachment: {
        id: 'evidence', path: 'evidence.bin', mime: 'application/octet-stream',
        checksum: 'sha256:missing', bytes: 1,
      },
    }]
    const result = await aiwgFortemiIndexToKnowledgeShardWithReport(source, {
      createdAt: '2026-07-22T12:00:00.000Z', matricVersion: '2026.7.13-test',
    })
    expect(result.success).toBe(false)
    expect(result.archive).toBeNull()
    expect(result.lossless).toBe(false)
    expect(result.receipt.contract_valid).toBe(false)
    expect(result.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'aiwg-attachment-bytes-unavailable', action: 'omit', source_state: 'value',
      }),
    ]))
  })

  it('fails closed when SKOS relation fields have no native destination', async () => {
    const source = sourceIndex()
    source.items[0].skos_relations = [{
      source_id: 'concept:portable', target_id: 'concept:portable', type: 'related',
      source_path: 'concepts.json', metadata: { reviewed: true },
    }]
    const result = await aiwgFortemiIndexToKnowledgeShardWithReport(source, {
      createdAt: '2026-07-22T12:00:00.000Z', matricVersion: '2026.7.13-test',
    })
    expect(result.success).toBe(false)
    expect(result.archive).toBeNull()
    expect(result.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'aiwg-skos-relation-fields-unmapped',
        reason: 'source_path,metadata',
      }),
    ]))
  })

  it('imports through PGlite and converges on exact logical files', async () => {
    const converted = await aiwgFortemiIndexToKnowledgeShardWithReport(sourceIndex(), {
      createdAt: '2026-07-22T12:00:00.000Z', matricVersion: '2026.7.13-test',
    })
    const db = await createDb()
    try {
      const blobs = new MemoryBlobStore()
      expect(converted.success).toBe(true)
      const imported = await importShard(db, converted.archive!, {
        conflictStrategy: 'replace', blobStore: blobs,
      })
      expect(imported.success, imported.errors.join('; ')).toBe(true)
      expect(imported.component_counts).toMatchObject({ notes: 2, skos_concepts: 1, embeddings: 1 })
      const exported = await exportShardWithReport(db, {
        profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs,
      })
      expect(exported.success, exported.errors.join('; ')).toBe(true)
      const expectedFiles = unpackTarGz(converted.archive!)
      const actualFiles = unpackTarGz(exported.archive!)
      expect([...actualFiles.keys()].sort()).toEqual([...expectedFiles.keys()].sort())
      for (const [path, bytes] of expectedFiles) expect(actualFiles.get(path), path).toEqual(bytes)
    } finally {
      await db.close()
    }
  }, 30_000)
})
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
