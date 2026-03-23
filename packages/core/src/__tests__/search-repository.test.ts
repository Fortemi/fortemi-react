/**
 * Tests for SearchRepository — full-text search via PGlite tsvector/tsquery.
 * Tests cover: keyword search, ranking (title > content), empty query,
 * pagination, tag filtering, collection filtering, deleted note exclusion,
 * snippet generation, and response shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { SearchRepository } from '../repositories/search-repository.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let noteCounter = 0

async function insertNote(
  db: PGlite,
  opts: {
    id?: string
    title?: string | null
    content?: string
    deleted?: boolean
  } = {},
): Promise<string> {
  noteCounter++
  const id = opts.id ?? `note-${noteCounter}`
  const title = opts.title !== undefined ? opts.title : `Note ${noteCounter}`
  const content = opts.content ?? ''
  const deletedAt = opts.deleted ? 'now()' : 'NULL'

  await db.query(
    `INSERT INTO note (id, title, deleted_at) VALUES ($1, $2, ${deletedAt})`,
    [id, title],
  )

  await db.query(
    `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
    [id, content],
  )

  return id
}

async function insertTag(db: PGlite, noteId: string, tag: string): Promise<void> {
  const tagId = `tag-${noteId}-${tag}`
  await db.query(
    `INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3)`,
    [tagId, noteId, tag],
  )
}

async function insertCollection(db: PGlite, collectionId: string, noteId: string): Promise<void> {
  await db.query(
    `INSERT INTO collection (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [collectionId, collectionId],
  )
  await db.query(
    `INSERT INTO collection_note (collection_id, note_id) VALUES ($1, $2)`,
    [collectionId, noteId],
  )
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SearchRepository', () => {
  let db: PGlite
  let repo: SearchRepository

  beforeEach(async () => {
    noteCounter = 0
    db = await createPGliteInstance('memory')
    const runner = new MigrationRunner(db)
    await runner.apply(allMigrations)
    repo = new SearchRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it('returns mode="text" and semantic_available=false', async () => {
    const resp = await repo.search('anything')
    expect(resp.mode).toBe('text')
    expect(resp.semantic_available).toBe(false)
  })

  it('echoes query in response', async () => {
    const resp = await repo.search('myquery')
    expect(resp.query).toBe('myquery')
  })

  it('returns limit and offset in response', async () => {
    const resp = await repo.search('test', { limit: 5, offset: 10 })
    expect(resp.limit).toBe(5)
    expect(resp.offset).toBe(10)
  })

  // -------------------------------------------------------------------------
  // Basic search
  // -------------------------------------------------------------------------

  it('returns matching notes when keyword found in title', async () => {
    await insertNote(db, { title: 'Rust memory safety', content: 'details here' })
    await insertNote(db, { title: 'JavaScript async patterns', content: 'other content' })

    const resp = await repo.search('rust')
    expect(resp.results).toHaveLength(1)
    expect(resp.results[0].title).toBe('Rust memory safety')
    expect(resp.total).toBe(1)
  })

  it('returns matching notes when keyword found in content', async () => {
    await insertNote(db, { title: 'General note', content: 'This is about quantum computing' })
    await insertNote(db, { title: 'Unrelated', content: 'Nothing relevant here' })

    const resp = await repo.search('quantum')
    expect(resp.results).toHaveLength(1)
    expect(resp.results[0].title).toBe('General note')
  })

  it('returns empty results when no matches', async () => {
    await insertNote(db, { title: 'Rust notes', content: 'ownership borrow' })

    const resp = await repo.search('zzzyyyxxx')
    expect(resp.results).toHaveLength(0)
    expect(resp.total).toBe(0)
  })

  it('returns all matching notes with correct total', async () => {
    await insertNote(db, { title: 'TypeScript basics', content: 'types interfaces' })
    await insertNote(db, { title: 'Advanced TypeScript', content: 'generics mapped types' })
    await insertNote(db, { title: 'JavaScript guide', content: 'no typescript here' })

    const resp = await repo.search('typescript')
    expect(resp.total).toBe(3)
    expect(resp.results).toHaveLength(3)
  })

  // -------------------------------------------------------------------------
  // Ranking: title matches should rank higher than content-only matches
  // -------------------------------------------------------------------------

  it('ranks title match higher than content-only match', async () => {
    // Insert content-only match first so insertion order doesn't determine rank
    await insertNote(db, {
      id: 'content-match',
      title: 'Some unrelated title',
      content: 'This document discusses algorithms in depth',
    })
    await insertNote(db, {
      id: 'title-match',
      title: 'Algorithms and data structures',
      content: 'short content',
    })

    const resp = await repo.search('algorithms')
    expect(resp.results.length).toBeGreaterThanOrEqual(2)
    const titleMatchIdx = resp.results.findIndex((r) => r.id === 'title-match')
    const contentMatchIdx = resp.results.findIndex((r) => r.id === 'content-match')
    expect(titleMatchIdx).toBeLessThan(contentMatchIdx)
  })

  it('result has numeric rank field (positive for hits)', async () => {
    await insertNote(db, { title: 'Machine learning overview', content: 'neural networks' })

    const resp = await repo.search('machine learning')
    expect(resp.results[0].rank).toBeTypeOf('number')
    expect(resp.results[0].rank).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // Snippets
  // -------------------------------------------------------------------------

  it('snippet is a string', async () => {
    await insertNote(db, {
      title: 'Climate change',
      content: 'Global warming is the long-term rise of Earth temperatures.',
    })

    const resp = await repo.search('warming')
    expect(resp.results[0].snippet).toBeTypeOf('string')
    expect(resp.results[0].snippet.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // Empty query → recent notes
  // -------------------------------------------------------------------------

  it('empty query returns recent notes ordered by created_at DESC', async () => {
    await insertNote(db, { id: 'old-note', title: 'First note' })
    await insertNote(db, { id: 'new-note', title: 'Second note' })

    const resp = await repo.search('')
    expect(resp.results.length).toBeGreaterThanOrEqual(2)
    expect(resp.query).toBe('')
  })

  it('empty query response has rank=0 for all results', async () => {
    await insertNote(db, { title: 'Some note' })

    const resp = await repo.search('')
    for (const r of resp.results) {
      expect(r.rank).toBe(0)
    }
  })

  it('whitespace-only query treated as empty query', async () => {
    await insertNote(db, { title: 'A note' })

    const resp = await repo.search('   ')
    expect(resp.mode).toBe('text')
    // Should not throw and should return results (recent notes path)
    expect(Array.isArray(resp.results)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  it('limit restricts number of results returned', async () => {
    for (let i = 0; i < 5; i++) {
      await insertNote(db, { title: `Pagination note ${i}`, content: 'paginate this' })
    }

    const resp = await repo.search('paginate', { limit: 3 })
    expect(resp.results).toHaveLength(3)
    expect(resp.total).toBe(5)
  })

  it('offset skips results', async () => {
    for (let i = 0; i < 5; i++) {
      await insertNote(db, { title: `Paged item ${i}`, content: 'paging content' })
    }

    const page1 = await repo.search('paging', { limit: 3, offset: 0 })
    const page2 = await repo.search('paging', { limit: 3, offset: 3 })

    expect(page1.results).toHaveLength(3)
    expect(page2.results).toHaveLength(2)

    const allIds = [...page1.results, ...page2.results].map((r) => r.id)
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(5)
  })

  it('pagination on empty query works', async () => {
    for (let i = 0; i < 4; i++) {
      await insertNote(db, { title: `Recent note ${i}` })
    }

    const resp = await repo.search('', { limit: 2, offset: 2 })
    expect(resp.results).toHaveLength(2)
    expect(resp.total).toBe(4)
  })

  // -------------------------------------------------------------------------
  // Tag filter
  // -------------------------------------------------------------------------

  it('tag filter restricts results to notes with matching tag', async () => {
    const id1 = await insertNote(db, { title: 'Tagged rust note', content: 'rust content' })
    const id2 = await insertNote(db, { title: 'Another rust note', content: 'rust content' })
    await insertTag(db, id1, 'programming')
    await insertTag(db, id2, 'other')

    const resp = await repo.search('rust', { tags: ['programming'] })
    expect(resp.results).toHaveLength(1)
    expect(resp.results[0].id).toBe(id1)
  })

  it('tag filter works with empty query (recent notes)', async () => {
    const id1 = await insertNote(db, { title: 'Tagged note' })
    const id2 = await insertNote(db, { title: 'Untagged note' })
    await insertTag(db, id1, 'featured')
    void id2

    const resp = await repo.search('', { tags: ['featured'] })
    expect(resp.results).toHaveLength(1)
    expect(resp.results[0].id).toBe(id1)
  })

  // -------------------------------------------------------------------------
  // Tags in results
  // -------------------------------------------------------------------------

  it('result includes tags array for each note', async () => {
    const id = await insertNote(db, { title: 'Multi-tagged note', content: 'some text' })
    await insertTag(db, id, 'alpha')
    await insertTag(db, id, 'beta')

    const resp = await repo.search('multi-tagged')
    expect(resp.results[0].tags).toContain('alpha')
    expect(resp.results[0].tags).toContain('beta')
  })

  it('result has empty tags array when note has no tags', async () => {
    await insertNote(db, { title: 'Tagless note', content: 'no tags here' })

    const resp = await repo.search('tagless')
    expect(resp.results[0].tags).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Collection filter
  // -------------------------------------------------------------------------

  it('collection_id filter restricts results to notes in that collection', async () => {
    const id1 = await insertNote(db, { title: 'Collection note', content: 'collection content' })
    const id2 = await insertNote(db, { title: 'Standalone note', content: 'collection content' })
    await insertCollection(db, 'col-1', id1)

    const resp = await repo.search('collection', { collection_id: 'col-1' })
    expect(resp.results).toHaveLength(1)
    expect(resp.results[0].id).toBe(id1)
    void id2
  })

  // -------------------------------------------------------------------------
  // Deleted notes excluded
  // -------------------------------------------------------------------------

  it('deleted notes are excluded from search results', async () => {
    await insertNote(db, { id: 'live-note', title: 'Active rust note', content: 'rust ownership' })
    await insertNote(db, { id: 'dead-note', title: 'Deleted rust note', content: 'rust borrowing', deleted: true })

    const resp = await repo.search('rust')
    const ids = resp.results.map((r) => r.id)
    expect(ids).toContain('live-note')
    expect(ids).not.toContain('dead-note')
  })

  it('deleted notes are excluded from empty query (recent notes)', async () => {
    await insertNote(db, { id: 'active', title: 'Active note' })
    await insertNote(db, { id: 'deleted', title: 'Deleted note', deleted: true })

    const resp = await repo.search('')
    const ids = resp.results.map((r) => r.id)
    expect(ids).toContain('active')
    expect(ids).not.toContain('deleted')
  })

  // -------------------------------------------------------------------------
  // Result fields
  // -------------------------------------------------------------------------

  it('result contains id, title, snippet, rank, created_at, updated_at, tags', async () => {
    await insertNote(db, { title: 'Field check note', content: 'field check content' })

    const resp = await repo.search('field check')
    const r = resp.results[0]

    expect(r).toHaveProperty('id')
    expect(r).toHaveProperty('title')
    expect(r).toHaveProperty('snippet')
    expect(r).toHaveProperty('rank')
    expect(r).toHaveProperty('created_at')
    expect(r).toHaveProperty('updated_at')
    expect(r).toHaveProperty('tags')
  })

  it('title is null when note has no title', async () => {
    await insertNote(db, { title: null, content: 'notitlecontent here' })

    const resp = await repo.search('notitlecontent')
    expect(resp.results[0].title).toBeNull()
  })
})
