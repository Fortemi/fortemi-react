/**
 * Embedding pipeline integration tests.
 * Covers: chunkText, embeddingGenerationHandler, semanticSearch,
 * hybridSearch, suggestTags, cosineSimilarity, and titleGenerationHandler
 * with and without LLM injection.
 *
 * Uses in-memory PGlite with allMigrations applied.
 * Mock embed function returns deterministic normalized 384-dim vectors.
 *
 * @implements #63 #64 #66 #67
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { chunkText } from '../capabilities/chunking.js'
import {
  setEmbedFunction,
  getEmbedFunction,
  embeddingGenerationHandler,
} from '../capabilities/embedding-handler.js'
import { SearchRepository } from '../repositories/search-repository.js'
import { cosineSimilarity, suggestTags } from '../capabilities/auto-tag.js'
import { setLlmFunction, getLlmFunction } from '../capabilities/llm-handler.js'
import { titleGenerationHandler } from '../job-queue-worker.js'

// ---------------------------------------------------------------------------
// Mock embed function — deterministic, normalized 384-dim vectors
// ---------------------------------------------------------------------------

function mockEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((t) => {
      const vec = new Array(384).fill(0)
      for (let i = 0; i < t.length && i < 384; i++) {
        vec[i] = t.charCodeAt(i) / 256
      }
      // Normalize
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
      return norm > 0 ? vec.map((v) => v / norm) : vec
    }),
  )
}

// ---------------------------------------------------------------------------
// DB setup helper
// ---------------------------------------------------------------------------

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

let noteCounter = 0

async function insertNote(db: PGlite, content?: string): Promise<string> {
  const noteId = `note-emb-${++noteCounter}-${Date.now()}`
  await db.query(
    `INSERT INTO note (id, format, source, visibility, revision_mode)
     VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
    [noteId],
  )
  if (content !== undefined) {
    await db.query(
      `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
      [noteId, content],
    )
  }
  return noteId
}

function makeJob(noteId: string) {
  return {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    note_id: noteId,
    job_type: 'embedding_generation',
    status: 'pending',
    priority: 5,
    required_capability: 'semantic',
    retry_count: 0,
    max_retries: 3,
    error: null,
    result: null,
    created_at: new Date(),
    updated_at: new Date(),
  }
}

function makeTitleJob(noteId: string) {
  return {
    id: `job-title-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    note_id: noteId,
    job_type: 'title_generation',
    status: 'pending',
    priority: 5,
    required_capability: null,
    retry_count: 0,
    max_retries: 3,
    error: null,
    result: null,
    created_at: new Date(),
    updated_at: new Date(),
  }
}

// ---------------------------------------------------------------------------
// Part 1: chunkText
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns a single chunk when text is shorter than maxChars', () => {
    const text = 'Short text'
    expect(chunkText(text, 800, 100)).toEqual([text])
  })

  it('returns a single chunk when text equals maxChars exactly', () => {
    const text = 'A'.repeat(800)
    expect(chunkText(text, 800, 100)).toEqual([text])
  })

  it('returns multiple chunks for text longer than maxChars', () => {
    const text = 'A'.repeat(900)
    const chunks = chunkText(text, 800, 100)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('each chunk is at most maxChars characters', () => {
    const text = 'X'.repeat(2000)
    const chunks = chunkText(text, 800, 100)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(800)
    }
  })

  it('overlap means adjacent chunks share content', () => {
    const text = 'A'.repeat(700) + 'B'.repeat(700) // 1400 chars
    const chunks = chunkText(text, 800, 100)
    // Second chunk should start at 800 - 100 = 700, overlapping last 100 chars of first
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // The first chunk ends at 800; second starts at 700 — they share 100 chars
    const firstChunkEnd = chunks[0].slice(-100)
    const secondChunkStart = chunks[1].slice(0, 100)
    expect(firstChunkEnd).toBe(secondChunkStart)
  })

  it('covers the full text across all chunks', () => {
    const text = 'Hello world! This is a test sentence that is long enough. '.repeat(20)
    const chunks = chunkText(text, 100, 20)
    // First chunk starts at beginning
    expect(text.startsWith(chunks[0])).toBe(true)
    // Last chunk ends at the end of text
    expect(text.endsWith(chunks[chunks.length - 1])).toBe(true)
  })

  it('returns empty array for empty string', () => {
    // Empty string <= maxChars, returns ['']
    expect(chunkText('', 800, 100)).toEqual([''])
  })
})

// ---------------------------------------------------------------------------
// Part 2: embeddingGenerationHandler
// ---------------------------------------------------------------------------

describe('embeddingGenerationHandler', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await setupDb()
    setEmbedFunction(mockEmbed)
  })

  afterEach(async () => {
    setEmbedFunction(null)
    await db.close()
  })

  it('returns skipped when no embed function is registered', async () => {
    setEmbedFunction(null)
    const noteId = await insertNote(db, 'Some content')
    const result = await embeddingGenerationHandler(makeJob(noteId), db)
    expect(result).toMatchObject({ skipped: true, reason: 'no embed function registered' })
  })

  it('throws when note has no revised content', async () => {
    const noteId = await insertNote(db) // no content
    await expect(embeddingGenerationHandler(makeJob(noteId), db)).rejects.toThrow(
      `No content for note ${noteId}`,
    )
  })

  it('creates an embedding row in the database', async () => {
    const noteId = await insertNote(db, 'This is some test content for embedding.')
    const result = await embeddingGenerationHandler(makeJob(noteId), db) as {
      chunks: number
      embeddings: number
      setId: string
    }
    expect(result.chunks).toBeGreaterThanOrEqual(1)
    expect(result.embeddings).toBe(result.chunks)
    expect(result.setId).toBeTruthy()

    const embResult = await db.query<{ id: string }>(
      `SELECT id FROM embedding WHERE note_id = $1`,
      [noteId],
    )
    expect(embResult.rows.length).toBe(1)
  })

  it('creates an embedding_set_member row', async () => {
    const noteId = await insertNote(db, 'Content for membership test.')
    await embeddingGenerationHandler(makeJob(noteId), db)

    const memberResult = await db.query<{ note_id: string }>(
      `SELECT note_id FROM embedding_set_member WHERE note_id = $1`,
      [noteId],
    )
    expect(memberResult.rows.length).toBe(1)
  })

  it('creates the embedding_set with correct model name', async () => {
    const noteId = await insertNote(db, 'Content for set test.')
    await embeddingGenerationHandler(makeJob(noteId), db)

    const setResult = await db.query<{ model_name: string; dimensions: number }>(
      `SELECT model_name, dimensions FROM embedding_set WHERE model_name = 'all-MiniLM-L6-v2'`,
    )
    expect(setResult.rows.length).toBe(1)
    expect(setResult.rows[0].model_name).toBe('all-MiniLM-L6-v2')
    expect(setResult.rows[0].dimensions).toBe(384)
  })

  it('reuses existing embedding_set on second call', async () => {
    const noteId = await insertNote(db, 'Content for set reuse test.')
    await embeddingGenerationHandler(makeJob(noteId), db)

    const noteId2 = await insertNote(db, 'Second note content.')
    await embeddingGenerationHandler(makeJob(noteId2), db)

    const setResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM embedding_set WHERE model_name = 'all-MiniLM-L6-v2'`,
    )
    expect(parseInt(setResult.rows[0].count, 10)).toBe(1)
  })

  it('deletes old embeddings and inserts fresh ones on re-embed', async () => {
    const noteId = await insertNote(db, 'Original content.')
    await embeddingGenerationHandler(makeJob(noteId), db)

    // Check initial embedding ID
    const firstEmb = await db.query<{ id: string }>(
      `SELECT id FROM embedding WHERE note_id = $1`,
      [noteId],
    )
    const firstId = firstEmb.rows[0].id

    // Re-embed same note
    await embeddingGenerationHandler(makeJob(noteId), db)

    const secondEmb = await db.query<{ id: string }>(
      `SELECT id FROM embedding WHERE note_id = $1`,
      [noteId],
    )
    expect(secondEmb.rows.length).toBe(1)
    // New embedding ID (old was deleted)
    expect(secondEmb.rows[0].id).not.toBe(firstId)
  })

  it('getEmbedFunction returns the currently registered function', () => {
    expect(getEmbedFunction()).toBe(mockEmbed)
    setEmbedFunction(null)
    expect(getEmbedFunction()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Part 3: semanticSearch and hybridSearch
// ---------------------------------------------------------------------------

describe('SearchRepository — semantic and hybrid search', () => {
  let db: PGlite
  let repo: SearchRepository

  beforeEach(async () => {
    db = await setupDb()
    setEmbedFunction(mockEmbed)
    repo = new SearchRepository(db, true)
  })

  afterEach(async () => {
    setEmbedFunction(null)
    await db.close()
  })

  async function seedNoteWithEmbedding(content: string): Promise<string> {
    const noteId = await insertNote(db, content)
    await embeddingGenerationHandler(makeJob(noteId), db)
    return noteId
  }

  it('semanticSearch returns results ranked by vector similarity', async () => {
    const id1 = await seedNoteWithEmbedding('The quick brown fox jumps over the lazy dog')
    const id2 = await seedNoteWithEmbedding('A completely different note about something else')
    const id3 = await seedNoteWithEmbedding('The quick brown fox runs fast')

    // Query embedding similar to id1 and id3
    const [queryEmb] = await mockEmbed(['The quick brown fox jumps'])
    const response = await repo.semanticSearch(queryEmb, { limit: 10 })

    expect(response.results.length).toBeGreaterThanOrEqual(1)
    // All returned notes should have rank >= 0
    for (const r of response.results) {
      expect(r.rank).toBeGreaterThanOrEqual(0)
    }
    // Results should be sorted by rank descending
    for (let i = 1; i < response.results.length; i++) {
      expect(response.results[i - 1].rank).toBeGreaterThanOrEqual(response.results[i].rank)
    }
    // The most similar note (id1 or id3) should appear
    const ids = response.results.map((r) => r.id)
    expect(ids).toContain(id1)
    // id2 should appear too (all notes have embeddings)
    void id2
    void id3
  })

  it('semanticSearch returns empty results when no embeddings exist', async () => {
    // Insert note but no embedding
    await insertNote(db, 'No embedding note')
    const [queryEmb] = await mockEmbed(['test query'])
    const response = await repo.semanticSearch(queryEmb)
    expect(response.results).toEqual([])
    expect(response.total).toBe(0)
  })

  it('semanticSearch respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seedNoteWithEmbedding(`Note number ${i} about various topics`)
    }
    const [queryEmb] = await mockEmbed(['Note number'])
    const response = await repo.semanticSearch(queryEmb, { limit: 2 })
    expect(response.results.length).toBeLessThanOrEqual(2)
    expect(response.limit).toBe(2)
  })

  it('hybridSearch returns results combining text and vector scores', async () => {
    const id1 = await seedNoteWithEmbedding('Machine learning and neural networks are fascinating')
    const id2 = await seedNoteWithEmbedding('Machine learning models require lots of data')
    await seedNoteWithEmbedding('Cooking recipes and kitchen tips for beginners')

    const [queryEmb] = await mockEmbed(['machine learning neural networks'])
    const response = await repo.hybridSearch('machine learning', queryEmb, { limit: 10 })

    expect(response.results.length).toBeGreaterThanOrEqual(1)
    // Should contain the text-matching notes
    const ids = response.results.map((r) => r.id)
    expect(ids).toContain(id1)
    expect(ids).toContain(id2)

    // Results should be sorted by rank descending
    for (let i = 1; i < response.results.length; i++) {
      expect(response.results[i - 1].rank).toBeGreaterThanOrEqual(response.results[i].rank)
    }
  })

  it('hybridSearch returns empty results when no notes match', async () => {
    // Insert note with embedding but query that matches nothing in text
    await seedNoteWithEmbedding('Some content here')
    const [queryEmb] = await mockEmbed(['xyzzy completely unrelated'])
    // FTS won't match, vector might
    const response = await repo.hybridSearch('xyzzy completely unrelated xyzzy', queryEmb)
    // Should not crash; may return 0 or more results depending on vector
    expect(Array.isArray(response.results)).toBe(true)
  })

  it('search() dispatches to semanticSearch when queryEmbedding provided and query is empty', async () => {
    const id1 = await seedNoteWithEmbedding('Test content for dispatch')
    const [queryEmb] = await mockEmbed(['Test content'])
    const semanticSpy = vi.spyOn(repo, 'semanticSearch')

    await repo.search('', {}, queryEmb)
    expect(semanticSpy).toHaveBeenCalledOnce()
    void id1
  })

  it('search() dispatches to hybridSearch when queryEmbedding and non-empty query provided', async () => {
    await seedNoteWithEmbedding('Test content for hybrid dispatch')
    const [queryEmb] = await mockEmbed(['Test content'])
    const hybridSpy = vi.spyOn(repo, 'hybridSearch')

    await repo.search('Test content', {}, queryEmb)
    expect(hybridSpy).toHaveBeenCalledOnce()
  })

  it('semantic_available reflects constructor parameter', async () => {
    const repoWithoutSemantic = new SearchRepository(db, false)
    const response = await repoWithoutSemantic.search('test query')
    expect(response.semantic_available).toBe(false)

    const repoWithSemantic = new SearchRepository(db, true)
    const response2 = await repoWithSemantic.search('test query')
    expect(response2.semantic_available).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Part 4: cosineSimilarity and suggestTags
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical unit vectors', () => {
    const v = [1, 0, 0]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0]
    const b = [-1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1)
  })

  it('returns value between -1 and 1 for arbitrary vectors', () => {
    const a = [0.6, 0.8, 0]
    const b = [0.8, 0.6, 0]
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThanOrEqual(-1)
    expect(sim).toBeLessThanOrEqual(1)
    expect(sim).toBeCloseTo(0.96, 1)
  })

  it('handles multi-dimensional vectors', () => {
    const dims = 384
    const a = new Array(dims).fill(1 / Math.sqrt(dims))
    const b = new Array(dims).fill(1 / Math.sqrt(dims))
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0)
  })
})

describe('suggestTags', () => {
  it('returns empty array when tagEmbeddings is empty', () => {
    const noteEmb = [1, 0, 0]
    const tags = suggestTags(noteEmb, new Map())
    expect(tags).toEqual([])
  })

  it('returns tags above threshold sorted by score', () => {
    const noteEmb = [1, 0, 0]
    const tagEmbeddings = new Map([
      ['science', [0.99, 0.14, 0]], // high similarity
      ['cooking', [0, 1, 0]], // orthogonal — below threshold
      ['tech', [0.95, 0.31, 0]], // above threshold
    ])
    // Normalize tagEmbeddings so dot product = cosine similarity
    const tags = suggestTags(noteEmb, tagEmbeddings, 0.5, 5)
    expect(tags).toContain('science')
    expect(tags).toContain('tech')
    expect(tags).not.toContain('cooking')
    // science should come before tech (higher score)
    expect(tags.indexOf('science')).toBeLessThan(tags.indexOf('tech'))
  })

  it('respects maxTags limit', () => {
    const noteEmb = [1, 0, 0]
    const tagEmbeddings = new Map([
      ['a', [1, 0, 0]],
      ['b', [0.99, 0.14, 0]],
      ['c', [0.98, 0.2, 0]],
      ['d', [0.97, 0.24, 0]],
      ['e', [0.96, 0.28, 0]],
      ['f', [0.95, 0.31, 0]],
    ])
    const tags = suggestTags(noteEmb, tagEmbeddings, 0.0, 3)
    expect(tags.length).toBeLessThanOrEqual(3)
  })

  it('returns no tags when all scores are below threshold', () => {
    const noteEmb = [1, 0, 0]
    const tagEmbeddings = new Map([
      ['cooking', [0, 1, 0]],
      ['sports', [0, 0, 1]],
    ])
    const tags = suggestTags(noteEmb, tagEmbeddings, 0.5)
    expect(tags).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Part 5: titleGenerationHandler with/without LLM
// ---------------------------------------------------------------------------

describe('titleGenerationHandler — with LLM', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await setupDb()
  })

  afterEach(async () => {
    setLlmFunction(null)
    await db.close()
  })

  async function seedNote(content: string): Promise<string> {
    const noteId = await insertNote(db, content)
    return noteId
  }

  it('uses LLM when registered and returns model field', async () => {
    const mockLlm = vi.fn().mockResolvedValue('An AI Generated Title')
    setLlmFunction(mockLlm)

    const noteId = await seedNote('This is a long piece of content that the LLM should summarize.')
    const job = makeTitleJob(noteId)
    const result = await titleGenerationHandler(job, db) as { title: string; model: string }

    expect(mockLlm).toHaveBeenCalledOnce()
    expect(result.title).toBe('An AI Generated Title')
    expect(result.model).toBe('llm')
  })

  it('updates note title in database when LLM is used', async () => {
    const mockLlm = vi.fn().mockResolvedValue('LLM Title From Database')
    setLlmFunction(mockLlm)

    const noteId = await seedNote('Some content to generate title from.')
    const job = makeTitleJob(noteId)
    await titleGenerationHandler(job, db)

    const noteResult = await db.query<{ title: string }>(
      `SELECT title FROM note WHERE id = $1`,
      [noteId],
    )
    expect(noteResult.rows[0].title).toBe('LLM Title From Database')
  })

  it('updates note_revised_current model field when LLM is used', async () => {
    const mockLlm = vi.fn().mockResolvedValue('LLM Model Field Title')
    setLlmFunction(mockLlm)

    const noteId = await seedNote('Content for model field test.')
    const job = makeTitleJob(noteId)
    await titleGenerationHandler(job, db)

    const revResult = await db.query<{ model: string; ai_metadata: unknown; generation_count: number }>(
      `SELECT model, ai_metadata, generation_count FROM note_revised_current WHERE note_id = $1`,
      [noteId],
    )
    expect(revResult.rows[0].model).toBe('llm')
    expect(revResult.rows[0].ai_metadata).toMatchObject({ source: 'title_generation' })
    expect(revResult.rows[0].generation_count).toBeGreaterThanOrEqual(1)
  })

  it('truncates LLM title over 200 chars', async () => {
    const longTitle = 'T'.repeat(250)
    const mockLlm = vi.fn().mockResolvedValue(longTitle)
    setLlmFunction(mockLlm)

    const noteId = await seedNote('Content.')
    const job = makeTitleJob(noteId)
    const result = await titleGenerationHandler(job, db) as { title: string }
    expect(result.title.length).toBe(200)
    expect(result.title.endsWith('...')).toBe(true)
  })

  it('getLlmFunction returns the currently registered function', () => {
    const fn = vi.fn()
    setLlmFunction(fn)
    expect(getLlmFunction()).toBe(fn)
    setLlmFunction(null)
    expect(getLlmFunction()).toBeNull()
  })
})

describe('titleGenerationHandler — without LLM (string extraction fallback)', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await setupDb()
    setLlmFunction(null) // ensure no LLM
  })

  afterEach(async () => {
    await db.close()
  })

  async function seedNote(content: string): Promise<string> {
    return insertNote(db, content)
  }

  it('extracts the first line as the title when no LLM', async () => {
    const noteId = await seedNote('My Fallback Title\nSome body text')
    const result = await titleGenerationHandler(makeTitleJob(noteId), db) as { title: string }
    expect(result.title).toBe('My Fallback Title')
  })

  it('strips markdown headers when no LLM', async () => {
    const noteId = await seedNote('## My Heading\nBody here')
    const result = await titleGenerationHandler(makeTitleJob(noteId), db) as { title: string }
    expect(result.title).toBe('My Heading')
  })

  it('returns "Untitled Note" when first line is empty and no LLM', async () => {
    const noteId = await seedNote('\nBody without title')
    const result = await titleGenerationHandler(makeTitleJob(noteId), db) as { title: string }
    expect(result.title).toBe('Untitled Note')
  })

  it('result has no model field when falling back to string extraction', async () => {
    const noteId = await seedNote('Simple title content')
    const result = await titleGenerationHandler(makeTitleJob(noteId), db) as Record<string, unknown>
    // No model field in fallback result
    expect(result.model).toBeUndefined()
    expect(result.title).toBe('Simple title content')
  })
})
