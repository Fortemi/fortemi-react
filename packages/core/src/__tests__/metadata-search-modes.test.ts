import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { allMigrations } from '../migrations/index.js'
import { MigrationRunner } from '../migration-runner.js'
import { createPGliteBackend, createRemoteBackend, createShardBackend } from '../data-backend.js'
import type { BackendSearchQueryOptions } from '../data-backend.js'
import { SearchRepository } from '../repositories/search-repository.js'
import { REGISTERED_METADATA_PATHS } from '../repositories/metadata-predicates.js'
import type { MetadataPredicate } from '../repositories/metadata-predicates.js'
import { MemoryRecordStore } from '../records/memory-record-store.js'
import { CanonicalNotesRepository } from '../records/canonical-notes-repository.js'
import { createRecordBackend } from '../records/record-backend.js'
import type { ShardReader } from '../shard/shard-reader.js'
import { searchTool } from '../tools/search.js'

const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)

describe('public search scope before ranking and limits', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
  })
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec(`TRUNCATE note CASCADE;
      INSERT INTO archive (id, name) VALUES ('other', 'Other') ON CONFLICT DO NOTHING;
      INSERT INTO embedding_set (id, model_name, dimensions) VALUES ('mode-set', 'synthetic', 384) ON CONFLICT DO NOTHING;
      INSERT INTO note (id, title, metadata, metadata_independent, source)
        SELECT 'excluded-' || i, repeat('needle ', 20),
          '{"provider":"2","model":"2","role":"2","event_kind":"2","sensitivity":"2"}', true, 'blocked'
        FROM generate_series(1, 110) i;
      INSERT INTO note (id, title, metadata, metadata_independent, source, archive_id, deleted_at)
        SELECT id, 'needle', '{"provider":2,"model":2,"role":2,"event_kind":2,"sensitivity":2}', true, 'allowed-b',
          CASE WHEN id = 'wrong-archive' THEN 'other' ELSE NULL END,
          CASE WHEN id = 'deleted' THEN NOW() ELSE NULL END
        FROM unnest(ARRAY['wanted','wrong-tenant','wrong-archive','deleted']) id;
      INSERT INTO source_identity
        (id, note_id, tenant_id, archive_id, namespace, external_id, external_id_hash, source_schema_version, content_digest, import_run_id)
        SELECT id, id, CASE WHEN id = 'wrong-tenant' THEN 'foreign' ELSE 'default' END, archive_id,
          'fixture', 'raw/' || id, 'hash', '1', 'digest', CASE WHEN id LIKE 'excluded-%' THEN 'run-1' ELSE 'run-2' END FROM note;
      INSERT INTO source_identity
        (id, note_id, tenant_id, namespace, external_id, external_id_hash, source_schema_version, content_digest, import_run_id)
        VALUES ('foreign-duplicate', 'wanted', 'foreign', 'hidden', 'raw/foreign', 'hash', '1', 'digest', 'run-2');
      INSERT INTO note_tag (id, note_id, tag) SELECT id || '-one', id, 'one' FROM note;
      INSERT INTO note_tag (id, note_id, tag) SELECT id || '-two', id, 'two' FROM note WHERE id NOT LIKE 'excluded-%';`)
    const weaker = vector.map((_, i) => i === 0 ? 0.8 : i === 1 ? 0.6 : 0)
    await db.query(`INSERT INTO embedding (id, note_id, embedding_set_id, vector)
      SELECT id, id, 'mode-set', CASE WHEN id = 'wanted' THEN $1::vector ELSE $2::vector END FROM note`,
    [JSON.stringify(weaker), JSON.stringify(vector)])
  })

  for (const entry of ['backend', 'tool'] as const) {
    for (const path of REGISTERED_METADATA_PATHS) {
      for (const mode of ['fts', 'semantic', 'hybrid'] as const) {
        it(`${entry}/${path}/${mode} excludes stronger out-of-scope rows and projects only selected sources`, async () => {
          const embed = vi.fn().mockResolvedValue(vector)
          const backend = createPGliteBackend(db, { semanticAvailable: true, embedQuery: embed })
          const value = path === 'import_run_id' ? 'run-2' : 2
          const predicates: MetadataPredicate[] = [{ path, op: 'eq', value }, { path, op: 'in', value: [value] }, { path, op: 'range', gte: value, lte: value }]
          for (const predicate of predicates) {
            const scope = { limit: 1, tenant_id: 'default', archive_id: null, metadataPredicates: [predicate] }
            const result = entry === 'backend'
              ? await backend.search('needle', { ...scope, mode })
              : await searchTool(db, { query: 'needle', ...scope, mode: mode === 'fts' ? 'text' : mode, query_embedding: vector })
            const hits = 'hits' in result ? result.hits : result.results
            expect(hits.map(hit => 'note' in hit ? hit.note.id : hit.id)).toEqual(['wanted'])
            expect(result.total).toBe(1)
            expect(hits[0].locators?.map(locator => locator.source?.namespace)).toEqual(['fixture'])
            expect(JSON.stringify(hits[0].locators)).not.toMatch(/raw\/|hidden/)
          }
          expect(embed).toHaveBeenCalledTimes(entry === 'backend' && mode !== 'fts' ? 3 : 0)
        })
      }
    }
  }

  for (const mode of ['fts', 'semantic', 'hybrid'] as const) {
    it(`${mode} preserves public tag AND/source OR before top-k`, async () => {
      const backend = createPGliteBackend(db, { semanticAvailable: true, embedQuery: async () => vector })
      const scope = { limit: 1, tenant_id: 'default', archive_id: null, mode }
      for (const filter of [{ tags: ['one', 'two', 'one'] }, { source: ['allowed-a', 'allowed-b'] }]) {
        const result = await backend.search('needle', { ...scope, ...filter })
        expect(result.hits.map(hit => hit.note.id)).toEqual(['wanted'])
        expect(result.total).toBe(1)
      }
      const legacy = await new SearchRepository(db).search('needle', { mode: 'text', tags: ['one', 'two'], tenant_id: 'default', archive_id: null })
      expect(legacy.total).toBe(111)
    })
  }
})

describe('explicit capability and no-I/O boundaries', () => {
  for (const mode of ['fts', 'semantic', 'hybrid'] as const) {
    it(`${mode} rejects invalid metadata before embedding/database work`, async () => {
      const query = vi.fn(), embedQuery = vi.fn()
      const backend = createPGliteBackend({ query } as never, { semanticAvailable: true, embedQuery })
      const options = { mode, metadataPredicates: [{ path: 'unknown', op: 'eq', value: 'not-logged' }] } as unknown as BackendSearchQueryOptions
      await expect(backend.search('needle', options)).rejects.toThrow('METADATA_PREDICATES_INVALID')
      await expect(searchTool({ query } as never, { query: 'needle', ...options })).rejects.toThrow()
      expect(query).not.toHaveBeenCalled(); expect(embedQuery).not.toHaveBeenCalled()
    })
  }

  it('requires both vector storage and an embedder to advertise semantic operations', async () => {
    const query = vi.fn(), embedQuery = vi.fn()
    for (const options of [{ semanticAvailable: true }, { embedQuery }]) {
      const backend = createPGliteBackend({ query } as never, options)
      expect(backend.capabilities.semantic).toBe('none')
      expect(backend.semantic).toBeUndefined()
      for (const mode of ['semantic', 'hybrid'] as const) {
        await expect(backend.search('needle', { mode })).rejects.toThrow('BACKEND_SEARCH_MODE_UNSUPPORTED')
      }
    }
    expect(query).not.toHaveBeenCalled(); expect(embedQuery).not.toHaveBeenCalled()
  })

  it('rejects malformed embedder output before SQL', async () => {
    for (const value of [[], [NaN], [Infinity], null, undefined, Array(384)]) {
      const query = vi.fn()
      const backend = createPGliteBackend({ query } as never, { semanticAvailable: true, embedQuery: vi.fn().mockResolvedValue(value) })
      await expect(backend.semantic!('needle')).rejects.toThrow('BACKEND_QUERY_EMBEDDING_INVALID')
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('rejects unsupported scope before static, record or remote I/O including credentials', async () => {
    const store = new MemoryRecordStore(), list = vi.spyOn(store, 'list'), read = vi.fn(), fetchImpl = vi.fn(), headers = vi.fn()
    const backends = [createRecordBackend(store), createShardBackend({ search: read } as unknown as ShardReader),
      createRemoteBackend({ baseUrl: 'http://127.0.0.1:1', fetchImpl, headers })]
    for (const backend of backends) {
      for (const scope of [{ tenant_id: 'other' }, { archive_id: null }]) {
        await expect(backend.search('needle', scope)).rejects.toThrow('BACKEND_SEARCH_SCOPE_UNSUPPORTED')
      }
    }
    expect(list).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled(); expect(headers).not.toHaveBeenCalled()
    await store.close()
  })

  it('applies record tag/source filters before its bounded result limit', async () => {
    const store = new MemoryRecordStore(), notes = new CanonicalNotesRepository(store)
    try {
      await notes.create({ title: 'needle excluded', content: '', source: 'blocked' })
      const wanted = await notes.create({ title: 'needle wanted', content: '', source: 'allowed-b' })
      await notes.addTag(wanted.note.id, 'one'); await notes.addTag(wanted.note.id, 'two')
      const backend = createRecordBackend(store)
      for (const filter of [{ tags: ['one', 'two'] }, { source: ['allowed-a', 'allowed-b'] }]) {
        expect((await backend.search('needle', { limit: 1, ...filter })).hits.map(hit => hit.note.id)).toEqual([wanted.note.id])
      }
    } finally { await store.close() }
  })
})
