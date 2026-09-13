import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { allMigrations } from '../migrations/index.js'
import { MigrationRunner } from '../migration-runner.js'
import { SearchRepository } from '../repositories/search-repository.js'

const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)
const body = 'prefix \u{1f680} cafe\u0301 needle body evidence'

describe('citation reproduction required by producer1091/consumer405', () => {
  let db: PGlite
  let search: SearchRepository
  beforeAll(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
    search = new SearchRepository(db, true)
  })
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec(`TRUNCATE note CASCADE;
      INSERT INTO embedding_set (id, model_name, dimensions)
      VALUES ('citation-set', 'synthetic', 384) ON CONFLICT DO NOTHING;`)
    await db.query('INSERT INTO note (id, title) VALUES ($1, $2)', ['citation-note', 'Unrelated title'])
    await db.query('INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)', ['citation-note', body])
  })

  it('control: lexical search returns the correct note and highlights its body match', async () => {
    const response = await search.search('needle', { mode: 'text' })
    expect(response.results.map(hit => hit.id)).toEqual(['citation-note'])
    expect(response.results[0].snippet).toContain('<mark>needle</mark>')
  })

  it('body citation supplies an explicit span instead of an unbounded current pointer', async () => {
    const hit = (await search.search('needle', { mode: 'text' })).results[0]
    expect(hit.evidence?.locators.length).toBeGreaterThan(0)
    const locator = hit.evidence!.locators.find(locator => locator.unit.kind === 'current')!
    expect(locator.span).toEqual({ unit: 'utf8-bytes', start: 0, end: new TextEncoder().encode(body).length })
    await expect(search.resolveEvidence(locator)).resolves.toBe(body)
  })

  it('title-only matches are not attributed to unrelated current content', async () => {
    await db.query('UPDATE note SET title = $1 WHERE id = $2', ['titlemarker', 'citation-note'])
    const hit = (await search.search('titlemarker', { mode: 'text' })).results[0]
    expect(hit.id).toBe('citation-note')
    expect(body).not.toContain('titlemarker')
    const locator = hit.evidence!.locators.find(locator => locator.unit.kind === 'title')!
    expect(locator).toBeDefined()
    await expect(search.resolveEvidence(locator)).resolves.toBe('titlemarker')
    expect(hit.evidence!.locators.some(locator => locator.unit.kind === 'current')).toBe(false)
  })

  it('attachment-only matches retain their attachment source', async () => {
    await db.query('INSERT INTO attachment_blob (id, content_hash, size_bytes) VALUES ($1, $2, 10)', ['citation-blob', 'a'.repeat(64)])
    await db.query(`INSERT INTO attachment
      (id, note_id, blob_id, filename, mime_type, extracted_text, status)
      VALUES ($1, $2, $3, 'fixture.txt', 'text/plain', 'attachmentmarker evidence', 'completed')`,
    ['citation-attachment', 'citation-note', 'citation-blob'])
    const hit = (await search.search('attachmentmarker', { mode: 'text' })).results[0]
    expect(hit.id).toBe('citation-note')
    expect(hit.snippet).toContain('<mark>attachmentmarker</mark>')
    expect(body).not.toContain('attachmentmarker')
    const locator = hit.evidence!.locators.find(locator => locator.unit.kind === 'attachment')!
    expect(locator.unit.id).toBe('citation-attachment')
    await expect(search.resolveEvidence(locator)).resolves.toBe('attachmentmarker evidence')
    expect(hit.evidence!.locators.some(locator => locator.unit.kind === 'current')).toBe(false)
  })

  for (const mode of ['semantic', 'hybrid'] as const) {
    it(`${mode} retains the winning nonzero embedding chunk`, async () => {
      const weaker = vector.map((_, i) => i === 1 ? 1 : 0)
      await db.query(`INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text, vector)
        VALUES ('first', 'citation-note', 'citation-set', 0, 'unrelated first chunk', $1::vector),
          ('winner', 'citation-note', 'citation-set', 7, 'needle winning chunk', $2::vector)`,
      [JSON.stringify(weaker), JSON.stringify(vector)])
      const hit = (await search.search('needle', { mode }, vector)).results[0]
      expect(hit.id).toBe('citation-note')
      const ranked = await db.query<{ id: string, chunk_index: number }>(
        'SELECT id, chunk_index FROM embedding ORDER BY vector <=> $1::vector LIMIT 1', [JSON.stringify(vector)])
      expect(ranked.rows).toEqual([{ id: 'winner', chunk_index: 7 }])
      const locator = hit.evidence!.locators.find(locator => locator.unit.kind === 'embedding')!
      expect(locator.unit).toEqual({ kind: 'embedding', id: 'winner', index: 7 })
      await expect(search.resolveEvidence(locator)).resolves.toBe('needle winning chunk')
      if (mode === 'hybrid') expect(hit.evidence!.locators.some(locator => locator.unit.kind === 'current')).toBe(true)
    })
  }

  it('different source text must not reuse the same citation locator', async () => {
    const before = (await search.search('needle', { mode: 'text' })).results[0]
    await db.query('UPDATE note_revised_current SET content = $1 WHERE note_id = $2', ['replacement needle evidence', 'citation-note'])
    const after = (await search.search('needle', { mode: 'text' })).results[0]
    expect(after.id).toBe(before.id)
    expect(after.snippet).not.toBe(before.snippet)
    expect(after.evidence).not.toEqual(before.evidence)
    await expect(search.resolveEvidence(before.evidence!.locators[0])).rejects.toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
    await expect(search.resolveEvidence(after.evidence!.locators[0])).resolves.toBe('replacement needle evidence')
  })
})
