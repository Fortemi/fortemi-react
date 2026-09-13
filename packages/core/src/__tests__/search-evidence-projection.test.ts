import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { allMigrations } from '../migrations/index.js'
import { MigrationRunner } from '../migration-runner.js'
import { SearchRepository } from '../repositories/search-repository.js'
import { createPGliteBackend } from '../data-backend.js'
import { parseSearchEvidenceSet } from '../search-evidence-set.js'
import { bindSearchEvidence, type EvidenceTextUnit } from '../search-evidence.js'

const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)
const raw = '\ufeffneedle \u{1f680} cafe\u0301\r\n<raw>'
describe('matched-unit evidence in actual PGlite ranking queries', () => {
  let db: PGlite
  let search: SearchRepository
  beforeAll(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
    search = new SearchRepository(db, true)
  })
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    vi.restoreAllMocks()
    await db.exec(`TRUNCATE note CASCADE;
      INSERT INTO archive (id, name) VALUES ('archive-a', 'A'), ('archive-b', 'B') ON CONFLICT DO NOTHING;
      INSERT INTO note (id, title, archive_id) VALUES ('note', 'Unrelated', 'archive-a');
      INSERT INTO embedding_set (id, model_name, dimensions) VALUES ('set', 'synthetic', 384) ON CONFLICT DO NOTHING;
      INSERT INTO attachment_blob (id, content_hash, size_bytes) VALUES ('blob', 'fixture', 10) ON CONFLICT DO NOTHING;`)
    await db.query("INSERT INTO note_revised_current (note_id, content) VALUES ('note', $1)", [raw])
  })
  async function embedding(text = raw, index = 7) {
    await db.query("INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text, vector) VALUES ('winner', 'note', 'set', $1, $2, $3::vector)", [index, text, JSON.stringify(vector)])
  }
  async function attachment(text = raw, id = 'attachment') {
    await db.query(`INSERT INTO attachment (id, note_id, blob_id, filename, mime_type, extracted_text, status)
      VALUES ($1, 'note', 'blob', 'private-filename.txt', 'text/plain', $2, 'completed')`, [id, text])
  }
  async function source(id: string, namespace: string, tenant = 'tenant-a', archive = 'archive-a', run = 'run-a') {
    await db.query(`INSERT INTO source_identity (id, tenant_id, archive_id, namespace, external_id,
      external_id_hash, source_schema_version, content_digest, import_run_id, note_id)
      VALUES ($1, $2, $3, $4, $5, $6, 'v1', 'unused', $7, 'note')`,
    [id, tenant, archive, namespace, 'private/raw/' + id, 'sha256:' + 'a'.repeat(64), run])
  }
  it.each(['current', 'title', 'attachment', 'embedding'] as const)('binds exact raw %s bytes in SQL, including BOM/CRLF/astral/combining text', async kind => {
    let unit: EvidenceTextUnit = { kind, id: 'note', index: 0 }
    if (kind === 'title') await db.query('UPDATE note SET title = $1', [raw])
    if (kind === 'attachment') { await attachment(); unit = { kind, id: 'attachment', index: 0 } }
    if (kind === 'embedding') { await embedding(); unit = { kind, id: 'winner', index: 7 } }
    const hit = (await search.search('needle', { mode: kind === 'embedding' ? 'semantic' : 'text' }, vector)).results[0]
    const expected = bindSearchEvidence({ note_id: 'note', unit, content: raw }, 0, new TextEncoder().encode(raw).length)
    expect(hit.evidence!.locators.find(locator => locator.unit.kind === kind)).toEqual(expected)
    expect(parseSearchEvidenceSet(hit.evidence, hit.id)).toEqual(hit.evidence)
    await expect(search.resolveEvidence(expected)).resolves.toBe(raw)
    expect(JSON.stringify(hit.evidence)).not.toContain('<raw>')
  })
  it('does not invent a unit for a conjunction that only matches combined body and attachment text', async () => {
    await attachment('separateword')
    const hit = (await search.search('needle separateword', { mode: 'text' })).results[0]
    expect(hit.id).toBe('note')
    expect(hit.evidence).toEqual({ version: '1.0.0', locators: [], omissions: ['unavailable-unit'] })
  })
  it('preserves a leading BOM in native hit identities, tags and embedding evidence', async () => {
    const id = '\ufeffnative-note'
    await db.exec('TRUNCATE note CASCADE')
    await db.query('INSERT INTO note (id, title) VALUES ($1, $2)', [id, 'Title'])
    await db.query('INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)', [id, raw])
    await db.query("INSERT INTO note_tag (id, note_id, tag) VALUES ('tag', $1, 'fixture')", [id])
    await db.query("INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text, vector) VALUES ('winner', $1, 'set', 7, $2, $3::vector)", [id, raw, JSON.stringify(vector)])
    for (const mode of ['text', 'semantic', 'hybrid'] as const) {
      const hit = (await search.search('needle', { mode }, vector)).results[0]
      expect(hit.id).toBe(id)
      expect(hit.tags).toEqual(['fixture'])
      expect(hit.has_embedding).toBe(true)
      expect(hit.evidence!.locators.every(locator => locator.note_id === id)).toBe(true)
      for (const locator of hit.evidence!.locators) await expect(search.resolveEvidence(locator)).resolves.toBe(raw)
    }
  })
  it('retains the semantic winner when lexical sources exceed the envelope limit', async () => {
    for (let i = 0; i < 70; i++) await attachment('needle ' + i, 'a-' + String(i).padStart(3, '0'))
    await embedding()
    const hit = (await search.search('needle', { mode: 'hybrid' }, vector)).results[0]
    expect(hit.evidence!.locators).toHaveLength(64)
    expect(hit.evidence!.locators[0].unit).toEqual({ kind: 'embedding', id: 'winner', index: 7 })
    expect(hit.evidence!.omissions).toEqual(['locator-limit'])
    expect(new Set(hit.evidence!.locators.map(locator => JSON.stringify(locator))).size).toBe(64)
    expect(JSON.stringify(hit.evidence).length).toBeLessThan(120000)
    expect((await search.search('needle', { mode: 'hybrid' }, vector)).results[0].evidence).toEqual(hit.evidence)
  })
  it('retains distinct source tuples while excluding duplicates and other source scopes', async () => {
    await source('a', 'a'); await source('a-copy', 'a'); await source('b', 'b')
    await source('foreign', 'foreign', 'tenant-b')
    await source('archive', 'wrong-archive', 'tenant-a', 'archive-b')
    await source('run', 'wrong-run', 'tenant-a', 'archive-a', 'run-b')
    const scope = { tenant_id: 'tenant-a', archive_id: 'archive-a', metadataPredicates: [{ path: 'import_run_id', op: 'eq', value: 'run-a' }] } as const
    const hit = (await search.search('needle', { ...scope, mode: 'text' })).results[0]
    expect(hit.evidence!.locators.map(locator => locator.source?.namespace)).toEqual(['a', 'b'])
    expect(hit.evidence!.omissions).toEqual([])
    for (const locator of hit.evidence!.locators) await expect(search.resolveEvidence(locator, scope)).resolves.toBe(raw)
    expect(JSON.stringify(hit.evidence)).not.toContain('private/raw')
  })
  it('reports source fanout limits without losing the winning semantic unit', async () => {
    await embedding()
    for (let i = 0; i < 70; i++) await source('s-' + i, 's-' + String(i).padStart(3, '0'))
    const hit = (await search.search('', { mode: 'semantic', tenant_id: 'tenant-a' }, vector)).results[0]
    expect(hit.evidence!.locators).toHaveLength(64)
    expect(hit.evidence!.locators.every(locator => locator.unit.id === 'winner')).toBe(true)
    expect(hit.evidence!.omissions).toEqual(['locator-limit'])
  })
  it('reports out-of-budget text without returning a truncated content digest', async () => {
    await db.exec("UPDATE note_revised_current SET content = 'needle' || repeat(' ', 16777217)")
    const hit = (await search.search('needle', { mode: 'text' })).results[0]
    expect(hit.evidence).toEqual({ version: '1.0.0', locators: [], omissions: ['unavailable-unit'] })
  })
  it.each(['', 'invalid-index'] as const)('does not fabricate semantic evidence for %s text', async mode => {
    await embedding(mode === '' ? '' : raw, mode === 'invalid-index' ? -1 : 7)
    const hit = (await search.search('', { mode: 'semantic' }, vector)).results[0]
    expect(hit.evidence).toEqual({ version: '1.0.0', locators: [], omissions: ['unavailable-unit'] })
  })
  it('reports an unrepresentable source instead of disclosing its raw fields or using an unscoped fallback', async () => {
    await source('bad', 'x'.repeat(201))
    const hit = (await search.search('needle', { mode: 'text', tenant_id: 'tenant-a' })).results[0]
    expect(hit.evidence).toEqual({ version: '1.0.0', locators: [], omissions: ['unavailable-unit'] })
  })
  it('forwards the per-hit envelope through the PGlite adapter without advertising full capability', async () => {
    await embedding()
    const backend = createPGliteBackend(db, { semanticAvailable: true, embedQuery: async () => vector })
    expect(backend.capabilities.evidenceLocators).toBe(false)
    for (const mode of ['fts', 'semantic', 'hybrid'] as const) {
      const hit = (await backend.search('needle', { mode })).hits[0]
      expect(hit.evidence!.locators.length).toBeGreaterThan(0)
      expect(parseSearchEvidenceSet(hit.evidence, hit.note.id)).toEqual(hit.evidence)
    }
  })
  it('does not rebind a ranking snapshot to text replaced by a later query', async () => {
    const original = db.query.bind(db)
    let replaced = false
    vi.spyOn(db, 'query').mockImplementation(async (sql, params, options) => {
      const result = await original(sql, params, options)
      if (!replaced && sql.includes('AS evidence_projection')) {
        replaced = true
        await original("UPDATE note_revised_current SET content = 'replacement needle'")
      }
      return result
    })
    const hit = (await search.search('needle', { mode: 'text' })).results[0]
    expect(replaced).toBe(true)
    const expected = bindSearchEvidence({ note_id: 'note', unit: { kind: 'current', id: 'note', index: 0 }, content: raw }, 0, new TextEncoder().encode(raw).length)
    expect(hit.evidence!.locators).toEqual([expected])
    await expect(search.resolveEvidence(expected)).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })
  it('rechecks deletion before hybrid display hydration after ranking', async () => {
    await embedding()
    const original = db.query.bind(db)
    let deleted = false
    vi.spyOn(db, 'query').mockImplementation(async (sql, params, options) => {
      const result = await original(sql, params, options)
      if (!deleted && sql.includes('AS best_chunks')) {
        deleted = true
        await original('UPDATE note SET deleted_at = now()')
      }
      return result
    })
    expect((await search.search('needle', { mode: 'hybrid' }, vector)).results).toEqual([])
    expect(deleted).toBe(true)
  })
})
