import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { allMigrations } from '../migrations/index.js'
import { MigrationRunner } from '../migration-runner.js'
import { bindSearchEvidence, type EvidenceTextUnit } from '../search-evidence.js'
import { SearchRepository } from '../repositories/search-repository.js'
import type { SearchEvidenceScope } from '../repositories/search-evidence-repository.js'
import { LifecyclePurgeRepository } from '../repositories/lifecycle-purge-repository.js'

const noteId = 'evidence-note'
const body = '\ufeffprefix \u{1f680} cafe\u0301\r\nneedle'
const source = { namespace: 'fixture', external_id_hash: 'sha256:' + 'a'.repeat(64), import_run_id: 'run-a', schema_version: 'fixture.v1' }
const units: EvidenceTextUnit[] = [
  { kind: 'current', id: noteId, index: 0 }, { kind: 'title', id: noteId, index: 0 },
  { kind: 'embedding', id: 'evidence-embedding', index: 7 },
  { kind: 'attachment', id: 'evidence-attachment', index: 0 },
]
const texts = [body, 'Evidence title', 'stored winning chunk', 'extracted attachment text']
const locatorFor = (index = 0, withSource = false) => bindSearchEvidence({
  note_id: noteId, unit: units[index], content: texts[index], ...(withSource ? { source } : {}),
}, 0, new TextEncoder().encode(texts[index]).length)

describe('candidate evidence resolution from scoped current PGlite storage', () => {
  let db: PGlite
  let search: SearchRepository
  beforeAll(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
    search = new SearchRepository(db)
  })
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    vi.restoreAllMocks()
    await db.exec(`TRUNCATE note CASCADE;
      INSERT INTO archive (id, name) VALUES ('archive-a', 'Evidence archive') ON CONFLICT DO NOTHING;
      INSERT INTO embedding_set (id, model_name, dimensions)
      VALUES ('evidence-set', 'synthetic', 384) ON CONFLICT DO NOTHING;`)
    await db.query(`INSERT INTO note (id, title, archive_id, visibility, metadata)
      VALUES ($1, $2, 'archive-a', 'private', '{"provider":"fixture","sensitivity":true}')`, [noteId, texts[1]])
    await db.query('INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)', [noteId, body])
    await db.query(`INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text)
      VALUES ($1, $2, 'evidence-set', 7, $3)`, [units[2].id, noteId, texts[2]])
    await db.query(`INSERT INTO attachment_blob (id, content_hash, size_bytes)
      VALUES ('evidence-blob', $1, 10) ON CONFLICT DO NOTHING`, ['a'.repeat(64)])
    await db.query(`INSERT INTO attachment (id, note_id, blob_id, filename, mime_type, extracted_text, status)
      VALUES ($1, $2, 'evidence-blob', 'fixture.txt', 'text/plain', $3, 'completed')`, [units[3].id, noteId, texts[3]])
  })
  async function addSource(tenant = 'default', archive: string | null = 'archive-a') {
    await db.query(`INSERT INTO source_identity
      (id, note_id, tenant_id, archive_id, namespace, external_id, external_id_hash,
       source_schema_version, content_digest, import_run_id)
      VALUES ('evidence-source', $1, $2, $3, $4, 'private/raw/path', $5, $6, 'unused', $7)`,
    [noteId, tenant, archive, source.namespace, source.external_id_hash, source.schema_version, source.import_run_id])
  }

  it.each(units.map((unit, index) => [unit.kind, index] as const))('resolves %s using one bounded query', async (_, index) => {
    const query = vi.spyOn(db, 'query')
    await expect(search.resolveEvidence(locatorFor(index), { archive_id: 'archive-a', visibility: 'private' })).resolves.toBe(texts[index])
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toContain('CASE WHEN octet_length(')
    expect(query.mock.calls[0][0]).not.toContain('external_id,')
  })

  it('returns an exact UTF-8 slice without trimming, normalization or HTML processing', async () => {
    const locator = bindSearchEvidence({ note_id: noteId, unit: units[0], content: body }, 10, 14)
    await expect(search.resolveEvidence(locator)).resolves.toBe('\u{1f680}')
    await expect(search.resolveEvidence(locatorFor())).resolves.toBe(body)
  })

  it.each([
    [0, 'UPDATE note_revised_current SET content = $1', 'replacement'],
    [1, 'UPDATE note SET title = $1', 'replacement'],
    [2, 'UPDATE embedding SET text = $1', 'replacement'],
    [2, 'UPDATE embedding SET id = $1', 'replacement'],
    [2, 'UPDATE embedding SET chunk_index = $1', 8],
    [3, 'UPDATE attachment SET extracted_text = $1', 'replacement'],
    [3, 'UPDATE attachment SET id = $1', 'replacement'],
    [3, 'UPDATE attachment SET status = $1', 'uploaded'],
    [3, 'UPDATE attachment SET extracted_text = $1', null],
  ] as const)('rejects changed unit %i: %s', async (index, sql, value) => {
    const locator = locatorFor(index)
    await db.query(sql, [value])
    await expect(search.resolveEvidence(locator)).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })

  it.each([0, 1, 2, 3])('rejects soft-deleted note for kind %i', async index => {
    await db.exec('UPDATE note SET deleted_at = now()')
    await expect(search.resolveEvidence(locatorFor(index))).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })
  it('rejects soft-deleted attachments', async () => {
    await db.exec('UPDATE attachment SET deleted_at = now()')
    await expect(search.resolveEvidence(locatorFor(3))).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })
  it('rejects every unit after the real terminal purge completes', async () => {
    await addSource()
    const locators = units.map((_, index) => locatorFor(index, true))
    const receipt = await new LifecyclePurgeRepository(db).purge({ note_ids: [noteId] }, 'evidence-purge')
    expect(receipt).toMatchObject({ outcome: 'completed', counts: { notes: 1, embeddings: 1, attachments: 1, source_identities: 1 } })
    for (const locator of locators) await expect(search.resolveEvidence(locator)).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })
  it('does not resolve an embedding attached to a different note', async () => {
    await db.exec("INSERT INTO note (id, title) VALUES ('other', 'Other'); UPDATE embedding SET note_id = 'other'")
    await expect(search.resolveEvidence(locatorFor(2))).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })
  it('does not resolve an attachment attached to a different note', async () => {
    await db.exec("INSERT INTO note (id, title) VALUES ('other', 'Other'); UPDATE attachment SET note_id = 'other'")
    await expect(search.resolveEvidence(locatorFor(3))).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })

  it('requires the source tuple in the selected tenant and note archive', async () => {
    await addSource('tenant-a')
    const locator = locatorFor(0, true)
    const query = vi.spyOn(db, 'query')
    await expect(search.resolveEvidence(locator, { tenant_id: 'tenant-a', archive_id: 'archive-a' })).resolves.toBe(body)
    expect(query).toHaveBeenCalledTimes(1)
    for (const scope of [{}, { tenant_id: 'tenant-b' }, { tenant_id: 'tenant-a', archive_id: 'archive-b' }, { tenant_id: 'tenant-a', archive_id: null }]) {
      await expect(search.resolveEvidence(locator, scope)).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    }
    await expect(search.resolveEvidence(locatorFor())).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    await expect(search.resolveEvidence(locatorFor(), { tenant_id: 'tenant-a' })).resolves.toBe(body)
  })
  it.each(['namespace', 'external_id_hash', 'import_run_id', 'source_schema_version', 'tenant_id', 'archive_id'] as const)(
    'rejects a changed source %s', async column => {
      await addSource()
      await db.query(`UPDATE source_identity SET ${column} = $1`, ['changed'])
      await expect(search.resolveEvidence(locatorFor(0, true))).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    },
  )
  it('rejects a missing source even when the native text is still available', async () => {
    await addSource()
    await db.exec('DELETE FROM source_identity')
    await expect(search.resolveEvidence(locatorFor(0, true))).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    await expect(search.resolveEvidence(locatorFor())).resolves.toBe(body)
  })
  it('does not combine tuple fields from different source rows', async () => {
    await addSource()
    await db.exec(`INSERT INTO source_identity
      SELECT 'second', tenant_id, archive_id, namespace, 'second-key', external_id_hash,
        source_schema_version, content_digest, 'run-b', caller_stable_id, note_id, created_at, updated_at
      FROM source_identity;
      UPDATE source_identity SET namespace = 'different' WHERE id = 'evidence-source'`)
    await expect(search.resolveEvidence(locatorFor(0, true))).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })
  it('rechecks author metadata, visibility, and same-source import-run predicates', async () => {
    await addSource()
    const locator = locatorFor(0, true)
    const scope: SearchEvidenceScope = { visibility: 'private', metadataPredicates: [
      { path: 'provider', op: 'eq', value: 'fixture' },
      { path: 'sensitivity', op: 'eq', value: true },
      { path: 'import_run_id', op: 'eq', value: 'run-a' },
    ] }
    await expect(search.resolveEvidence(locator, scope)).resolves.toBe(body)
    await expect(search.resolveEvidence(locator, { ...scope, visibility: 'public' })).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    await expect(search.resolveEvidence(locator, { metadataPredicates: [{ path: 'import_run_id', op: 'eq', value: 'run-b' }] })).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    await expect(search.resolveEvidence(locator, { metadataPredicates: [{ path: 'import_run_id', op: 'exists', value: false }] })).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    await db.exec("UPDATE note SET metadata = '{\"provider\":\"changed\",\"sensitivity\":true}'")
    await expect(search.resolveEvidence(locator, scope)).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })

  it('rejects malformed locators and predicates before any database access', async () => {
    const query = vi.spyOn(db, 'query')
    await expect(search.resolveEvidence({ ...locatorFor(), extra: 'private-value' })).rejects.toThrow('SEARCH_EVIDENCE_INVALID')
    await expect(search.resolveEvidence(locatorFor(), { metadataPredicates: [{ path: 'unknown', op: 'eq', value: 'private-value' }] } as unknown as SearchEvidenceScope)).rejects.toThrow('METADATA_PREDICATES_INVALID')
    expect(query).not.toHaveBeenCalled()
  })
  it.each([null, [], { tenant_id: null }, { tenant_id: '' }, { tenant_id: '\ud800' }, { archive_id: '\0' }, { archive_id: 1 }, { visibility: '' }, { visibility: null }, { tags: ['private'] }, { embeddingSetId: 'ignored' }])(
    'rejects malformed or unsupported scope %j before database access', async scope => {
      const query = vi.spyOn(db, 'query')
      await expect(search.resolveEvidence(locatorFor(), scope as unknown as SearchEvidenceScope)).rejects.toThrow('SEARCH_EVIDENCE_INVALID')
      expect(query).not.toHaveBeenCalled()
    },
  )
  it('withholds oversized UTF-8 text at the SQL projection, not after fetching it', async () => {
    const locator = locatorFor()
    await db.query('UPDATE note_revised_current SET content = repeat($1, 8388609)', ['\u00e9'])
    const query = vi.spyOn(db, 'query')
    await expect(search.resolveEvidence(locator)).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    expect(query).toHaveBeenCalledTimes(1)
    expect((await query.mock.results[0].value).rows).toEqual([{ content_hex: null }])
  })
})
