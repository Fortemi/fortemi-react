import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { createPGliteBackend, createRemoteBackend, createShardBackend, selectBackend } from '../data-backend.js'
import type { BackendSearchQueryOptions, DataBackend } from '../data-backend.js'
import { createRecordBackend } from '../records/record-backend.js'
import { MemoryRecordStore } from '../records/memory-record-store.js'
import type { ShardReader } from '../shard/shard-reader.js'
import { searchTool } from '../tools/search.js'
import corpus from '../../schemas/metadata-search/candidate/1.0.0/predicate-vectors.json'
import scopes from '../../schemas/metadata-search/candidate/1.0.0/sql-scope-vectors.json'

interface Row {
  id: string
  metadata?: Record<string, unknown>
  metadataJson?: string
  importRunId?: string
  identities?: { tenant: string; run: string }[]
  appendFixture?: string
}
interface Case {
  id: string
  rows?: Row[]
  predicates: unknown
  valid: boolean
  expectedIds?: string[]
}
const cases = [...corpus.cases, ...scopes.cases] as Case[]
const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)
const suffix = Array.from({ length: 512 }, (_, i) => createHash('sha256')
  .update(`synthetic-long-metadata-${i}`).digest('hex')).join('')

async function seed(db: PGlite, rows: Row[]) {
  await db.exec('TRUNCATE note CASCADE')
  for (const row of rows) {
    const metadata = { ...row.metadata }
    if (row.appendFixture) {
      expect(row.appendFixture).toBe('long-uncompressible-ascii')
      metadata.model = String(metadata.model) + suffix
    }
    await db.query('INSERT INTO note (id, title, metadata, metadata_independent) VALUES ($1, $1, $2::jsonb, true)',
      [row.id, row.metadataJson ?? JSON.stringify(metadata)])
    const identities = row.identities ?? (row.importRunId ? [{ tenant: 'tenant-a', run: row.importRunId }] : [])
    for (const [i, identity] of identities.entries()) {
      // Preserve the owning/default mapping used by the Core SQL corpus, not an auth claim.
      await db.query(`INSERT INTO source_identity
        (id, note_id, tenant_id, namespace, external_id, external_id_hash, source_schema_version, content_digest, import_run_id)
        VALUES ($1, $2, $3, 'fixture', $1, 'hash', '1', 'digest', $4)`,
      [`${row.id}-${i}`, row.id, identity.tenant === 'tenant-a' ? 'default' : identity.tenant, identity.run])
    }
  }
  await db.exec("INSERT INTO embedding_set (id, model_name, dimensions) VALUES ('adapter-set', 'synthetic', 384) ON CONFLICT DO NOTHING")
  await db.query("INSERT INTO embedding (id, note_id, embedding_set_id, vector) SELECT id, id, 'adapter-set', $1::vector FROM note", [JSON.stringify(vector)])
}

describe('PGlite public adapter and tool authority corpus', () => {
  let db: PGlite
  let backend: DataBackend
  beforeAll(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
    backend = createPGliteBackend(db, { semanticAvailable: true, embedQuery: async () => vector })
  })
  afterAll(async () => { await db?.close() })

  for (const entry of ['backend', 'tool'] as const) {
    for (const mode of ['fts', 'semantic', 'hybrid'] as const) {
    for (const fixture of cases) {
      it(`${entry}/${mode}: ${fixture.id}`, async () => {
        if (fixture.valid) await seed(db, fixture.rows ?? corpus.rows)
        const call = async () => entry === 'backend'
          ? (await backend.search('', { metadataPredicates: fixture.predicates, limit: 100, mode } as BackendSearchQueryOptions)).hits.map(hit => hit.note.id)
          : (await searchTool(db, { query: '', metadataPredicates: fixture.predicates, limit: 100,
            mode: mode === 'fts' ? 'text' : mode, query_embedding: vector })).results.map(hit => hit.id)
        if (!fixture.valid) {
          const code = fixture.id.startsWith('reversed-') ? 'METADATA_RANGE_INVALID' : 'METADATA_PREDICATES_INVALID'
          await expect(call()).rejects.toThrow(code)
        } else expect((await call()).sort()).toEqual([...fixture.expectedIds!].sort())
      })
    }
    }
  }
})

describe('unsupported adapter predicates fail before reads', () => {
  for (const kind of ['record', 'static', 'remote'] as const) {
    for (const fixture of cases) {
      it(`${kind}: ${fixture.id}`, async () => {
        const store = new MemoryRecordStore()
        const list = vi.spyOn(store, 'list')
        const read = vi.fn().mockResolvedValue({ items: [], total: 0 })
        const fetch = vi.fn().mockRejectedValue(new Error('unexpected network'))
        const backend = kind === 'record' ? createRecordBackend(store)
          : kind === 'static' ? createShardBackend({ search: read } as unknown as ShardReader)
            : createRemoteBackend({ baseUrl: 'http://127.0.0.1:1', fetchImpl: fetch })
        const code = fixture.valid ? 'BACKEND_METADATA_PREDICATES_UNSUPPORTED'
          : fixture.id.startsWith('reversed-') ? 'METADATA_RANGE_INVALID' : 'METADATA_PREDICATES_INVALID'
        await expect(backend.search('', { metadataPredicates: fixture.predicates } as BackendSearchQueryOptions)).rejects.toThrow(code)
        expect(list).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
        await store.close()
      })
    }
  }

  it('does not advertise unimplemented record locators', async () => {
    const store = new MemoryRecordStore()
    expect(store.capabilities.evidenceLocators).toBe(false)
    await store.close()
  })

  it('negotiates typed predicates separately from complete locators', () => {
    const unsupported = createRecordBackend(new MemoryRecordStore())
    const supported = createPGliteBackend({ query: vi.fn() } as never)
    expect(selectBackend({ typedMetadataPredicates: true }, [unsupported, supported]).backend).toBe(supported)
    expect(selectBackend({ typedMetadataPredicates: true }, [unsupported]).missing).toContain('typedMetadataPredicates')
    expect(selectBackend({ evidenceLocators: true }, [supported]).missing).toContain('evidenceLocators')
  })
})
