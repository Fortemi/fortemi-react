import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { buildMetadataPredicateConditions, REGISTERED_METADATA_PATHS, type MetadataPredicate } from '../repositories/metadata-predicates.js'
import { SearchRepository } from '../repositories/search-repository.js'
import type { DatabaseClient } from '../storage-backend.js'
import corpus from '../../schemas/metadata-search/candidate/1.0.0/predicate-vectors.json'
import scopes from '../../schemas/metadata-search/candidate/1.0.0/sql-scope-vectors.json'
import receipt from '../../schemas/metadata-search/candidate/1.0.0/contract.receipt.json'

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

const suffix = Array.from({ length: 512 }, (_, i) =>
  createHash('sha256').update(`synthetic-long-metadata-${i}`).digest('hex')).join('')

describe('authority candidate predicates through actual Core SQL', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
  })
  afterAll(async () => { await db?.close() })

  for (const fixture of [...corpus.cases, ...scopes.cases] as Case[]) {
    it(fixture.id, async () => {
      const compile = () => buildMetadataPredicateConditions({
        metadataPredicates: fixture.predicates as MetadataPredicate[],
      }, 1)
      if (!fixture.valid) {
        const code = fixture.id.startsWith('reversed-') ? 'METADATA_RANGE_INVALID' : 'METADATA_PREDICATES_INVALID'
        expect(compile).toThrow(code)
        return
      }
      await db.exec('TRUNCATE note CASCADE')
      const rows: Row[] = fixture.rows ?? corpus.rows
      for (const row of rows) {
        const metadata: Record<string, unknown> = { ...row.metadata }
        if (row.appendFixture) {
          expect(row.appendFixture).toBe('long-uncompressible-ascii')
          metadata.model = String(metadata.model) + suffix
        }
        await db.query('INSERT INTO note (id, metadata, metadata_independent) VALUES ($1, $2::jsonb, true)',
          [row.id, row.metadataJson ?? JSON.stringify(metadata)])
        const identities = row.identities ?? (row.importRunId ? [{ tenant: 'tenant-a', run: row.importRunId }] : [])
        for (const [i, identity] of identities.entries()) {
          // Core has a database-local default source scope, not a note tenant column.
          // Map the corpus's owning tenant to that scope; retain foreign identities.
          const tenant = identity.tenant === 'tenant-a' ? 'default' : identity.tenant
          await db.query(`INSERT INTO source_identity
            (id, note_id, tenant_id, namespace, external_id, external_id_hash, source_schema_version, content_digest, import_run_id)
            VALUES ($1, $2, $3, 'fixture', $1, 'hash', '1', 'digest', $4)`,
          [`${row.id}-${i}`, row.id, tenant, identity.run])
        }
      }
      const { conditions, joins, params } = compile()
      const result = await db.query<{ id: string }>(
        `SELECT n.id FROM note n ${joins.join(' ')} WHERE ${conditions.join(' AND ') || 'TRUE'}`, params)
      expect(result.rows.map(row => row.id).sort()).toEqual([...fixture.expectedIds!].sort())
    })
  }

  it('uses each selective authority index without disabling sequential scans', async () => {
    await db.exec(`TRUNCATE note CASCADE;
      INSERT INTO note (id, metadata, metadata_independent)
        SELECT 'plan-' || i, jsonb_build_object('model', i, 'provider', 'provider-' || i), true
        FROM generate_series(1, 10000) i;
      INSERT INTO source_identity
        (id, note_id, tenant_id, namespace, external_id, external_id_hash, source_schema_version, content_digest, import_run_id)
        SELECT 'si-' || i, 'plan-' || i, 'default', 'fixture', 'key-' || i, 'hash', '1', 'digest', 'run-' || i
        FROM generate_series(1, 10000) i;
      ANALYZE note; ANALYZE source_identity;`)
    for (const fixture of scopes.planPredicates) {
      const compiled = buildMetadataPredicateConditions({ metadataPredicates: fixture.predicates as MetadataPredicate[] }, 1)
      const plan = await db.query(`EXPLAIN (FORMAT JSON) SELECT n.id FROM note n WHERE ${compiled.conditions.join(' AND ')}`, compiled.params)
      expect(JSON.stringify(plan.rows), fixture.id).toContain(fixture.expectedIndex)
      const rows = await db.query<{ id: string }>(`SELECT n.id FROM note n WHERE ${compiled.conditions.join(' AND ')}`, compiled.params)
      expect(rows.rows.map(row => row.id)).toEqual(['plan-777'])
    }
  })

  for (const path of REGISTERED_METADATA_PATHS) {
    for (const mode of ['text', 'semantic', 'hybrid'] as const) {
      it(`${path}: typed pre-limit ${mode} and scoped source locators`, async () => {
        await db.exec(`TRUNCATE note CASCADE;
          INSERT INTO archive (id, name) VALUES ('other', 'Other') ON CONFLICT DO NOTHING;
          INSERT INTO note (id, title, metadata, metadata_independent)
            SELECT 'excluded-' || i, repeat('needle ', 10),
              '{"provider":"2","model":"2","role":"2","event_kind":"2","sensitivity":"2"}', true
            FROM generate_series(1, 110) i;
          INSERT INTO note (id, title, metadata, metadata_independent) VALUES
            ('wanted', 'needle', '{"provider":2,"model":2,"role":2,"event_kind":2,"sensitivity":2,"import_run_id":"decoy"}', true);
          INSERT INTO embedding_set (id, model_name, dimensions) VALUES ('typed-set', 'synthetic', 384) ON CONFLICT DO NOTHING;
          INSERT INTO source_identity
            (id, note_id, tenant_id, namespace, external_id, external_id_hash, source_schema_version, content_digest, import_run_id)
            SELECT id, id, 'default', 'fixture', 'raw/' || id, 'hash', '1', 'digest',
              CASE WHEN id = 'wanted' THEN 'run-2' ELSE 'run-1' END FROM note;
          INSERT INTO source_identity
            (id, note_id, tenant_id, archive_id, namespace, external_id, external_id_hash, source_schema_version, content_digest, import_run_id)
            VALUES ('second', 'wanted', 'default', NULL, 'second', 'raw/second', 'hash', '1', 'digest', 'run-2'),
              ('other-run', 'wanted', 'default', NULL, 'other-run', 'raw/other-run', 'hash', '1', 'digest', 'run-3'),
              ('foreign', 'wanted', 'foreign', NULL, 'hidden-tenant', 'raw/foreign', 'hash', '1', 'digest', 'run-2'),
              ('archive', 'wanted', 'default', 'other', 'hidden-archive', 'raw/archive', 'hash', '1', 'digest', 'run-2');`)
        const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)
        await db.query(`INSERT INTO embedding (id, note_id, embedding_set_id, vector)
          SELECT id, id, 'typed-set', $1::vector FROM note`, [JSON.stringify(vector)])
        const value = path === 'import_run_id' ? 'run-2' : 2
        const predicates: MetadataPredicate[] = [
          { path, op: 'eq', value }, { path, op: 'in', value: [value] },
          { path, op: 'range', gte: value, lte: value },
        ]
        const search = new SearchRepository(db, true)
        for (const predicate of predicates) {
          const response = await search.search('needle', {
            mode, limit: 1, tenant_id: 'default', archive_id: null, metadataPredicates: [predicate],
          }, vector)
          expect(response.results.map(row => row.id)).toEqual(['wanted'])
          expect(response.total).toBe(1)
          const locators = response.results[0].locators!
          expect(locators.map(locator => locator.source?.namespace).sort())
            .toEqual(path === 'import_run_id' ? ['fixture', 'second'] : ['fixture', 'other-run', 'second'])
          expect(JSON.stringify(locators)).not.toContain('raw/')
          expect(JSON.stringify(locators)).not.toContain('hidden-')
        }
      })
    }
  }

  it('upgrades version 32 without changing author or generated metadata', async () => {
    const old = await createPGliteInstance('memory')
    try {
      const runner = new MigrationRunner(old)
      await runner.apply(allMigrations.filter(migration => migration.version <= 32))
      const raw = `{"model":1e10000,"provider":"${'x'.repeat(32000)}"}`
      await old.query('INSERT INTO note (id, metadata, metadata_independent) VALUES ($1, $2::jsonb, true)', ['old', raw])
      await old.query('INSERT INTO note_revised_current (note_id, content, ai_metadata) VALUES ($1, $2, $3::jsonb)', ['old', 'original content', raw])
      const before = await old.query('SELECT metadata::text FROM note')
      await runner.apply(allMigrations)
      expect((await old.query('SELECT metadata::text FROM note')).rows).toEqual(before.rows)
      expect((await old.query('SELECT ai_metadata::text AS metadata FROM note_revised_current')).rows).toEqual(before.rows)
      await old.query('UPDATE note SET metadata = $1::jsonb', [JSON.stringify({ model: suffix })])
      await old.query('UPDATE note_revised_current SET ai_metadata = $1::jsonb', [JSON.stringify({ model: suffix })])
      expect((await old.query<{ model: string }>("SELECT metadata ->> 'model' AS model FROM note")).rows[0].model).toBe(suffix)
      const indexes = await old.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_note%metadata%'")
      expect(indexes.rows.map(row => row.indexname).sort()).toEqual(
        REGISTERED_METADATA_PATHS.filter(path => path !== 'import_run_id').map(path => `idx_note_metadata_${path}_v1`).sort())
    } finally { await old.close() }
  })
})

describe('metadata validation before database work', () => {
  it('binds unchanged candidate bytes without promoting upstream WIP', () => {
    expect(receipt.status).toBe('candidate-unpublished')
    expect(receipt.authority.baseCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(receipt.claims.promotedContract).toBe(false)
    for (const [path, digest] of Object.entries(receipt.authority.files)) {
      const bytes = readFileSync(new URL(`../../schemas/metadata-search/candidate/1.0.0/${path}`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest)
    }
  })

  it.each([NaN, Infinity, -Infinity, '\ud800', '\udfff'])('rejects non-JSON scalar %s with a content-free error', value => {
    expect(() => buildMetadataPredicateConditions({ metadataPredicates: [{ path: 'model', op: 'eq', value }] }, 1))
      .toThrow('METADATA_PREDICATES_INVALID')
  })

  it('validates every public entry before resolving a selector', async () => {
    const query = vi.fn().mockRejectedValue(new Error('must not reach database'))
    const search = new SearchRepository({ query } as unknown as DatabaseClient, true)
    const options = { metadataPredicates: [{ path: 'private-input' as never, op: 'eq' as const, value: 'secret-value' }], embeddingSetId: 'set' }
    for (const call of [() => search.search('needle', options), () => search.search('', options),
      () => search.semanticSearch([1], options), () => search.hybridSearch('needle', [1], options)]) {
      await expect(call()).rejects.toThrow(/^METADATA_PREDICATES_INVALID$/)
    }
    expect(query).not.toHaveBeenCalled()
  })
})
