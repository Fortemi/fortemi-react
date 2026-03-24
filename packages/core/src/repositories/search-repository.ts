/**
 * SearchRepository — full-text search using PGlite tsvector/tsquery,
 * with optional semantic search (pgvector) and hybrid (BM25 + vector RRF).
 *
 * Search strategy:
 *  - Title match uses the STORED tsvector column (weight A).
 *  - Content match uses an ad-hoc to_tsvector on note_revised_current.content (weight B).
 *  - ts_rank combines both weighted vectors to rank title matches higher.
 *  - ts_headline generates highlighted snippets from content.
 *  - Empty / whitespace-only queries fall back to returning recent notes.
 *  - semanticSearch uses pgvector cosine distance (<=>).
 *  - hybridSearch combines BM25 and vector with Reciprocal Rank Fusion (k=60).
 *  - Quoted phrases use phraseto_tsquery for exact phrase matching.
 *
 * @implements #64 semantic and hybrid search
 * @implements #77 correct mode field
 * @implements #79 date range filter
 * @implements #80 starred/archived filters
 * @implements #81 format/source/visibility filters
 * @implements #82 collection filter on semantic/hybrid
 * @implements #83 phrase search
 * @implements #87 shared condition builder
 * @implements #89 search mode selector
 * @implements #94 per-result embedding status
 */

import type { PGlite } from '@electric-sql/pglite'
import type { SearchResponse, SearchOptions, SearchFacets, SearchResult } from './types.js'
import { buildNoteConditions } from './condition-builder.js'

export class SearchRepository {
  constructor(
    private db: PGlite,
    private semanticAvailable = false,
  ) {}

  /** Select tsquery function based on whether query contains quoted phrases */
  private tsqueryFn(query: string): string {
    return query.includes('"') ? 'phraseto_tsquery' : 'plainto_tsquery'
  }

  /** Returns a Set of note IDs that have an embedding record */
  private async fetchEmbeddingSet(noteIds: string[]): Promise<Set<string>> {
    if (noteIds.length === 0) return new Set()
    const result = await this.db.query<{ note_id: string }>(
      `SELECT note_id FROM embedding WHERE note_id = ANY($1)`,
      [noteIds],
    )
    return new Set(result.rows.map((r) => r.note_id))
  }

  /** Attach has_embedding to each SearchResult using the provided embedding set */
  private attachEmbeddingStatus(
    results: Omit<SearchResult, 'has_embedding'>[],
    embeddingSet: Set<string>,
  ): SearchResult[] {
    return results.map((r) => ({ ...r, has_embedding: embeddingSet.has(r.id) }))
  }

  async search(
    query: string,
    options: SearchOptions = {},
    queryEmbedding?: number[],
  ): Promise<SearchResponse> {
    const { limit = 20, offset = 0 } = options
    const mode = options.mode ?? 'auto'

    // mode='text': force text path, ignore any provided embedding
    if (mode === 'text') {
      if (!query.trim()) {
        return this.recentNotes(options)
      }
      // Fall through to text search below
    } else if (mode === 'semantic') {
      // mode='semantic': require embedding
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error('mode=semantic requires a query embedding')
      }
      return this.semanticSearch(queryEmbedding, options)
    } else if (mode === 'hybrid') {
      // mode='hybrid': require embedding
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error('mode=hybrid requires a query embedding')
      }
      return this.hybridSearch(query, queryEmbedding, options)
    } else {
      // mode='auto' (default): existing auto-detect behavior
      if (queryEmbedding && queryEmbedding.length > 0) {
        if (query.trim()) {
          return this.hybridSearch(query, queryEmbedding, options)
        }
        return this.semanticSearch(queryEmbedding, options)
      }

      if (!query.trim()) {
        return this.recentNotes(options)
      }
    }

    // Text search path (mode='text' with non-empty query, or auto without embedding)
    if (!query.trim()) {
      return this.recentNotes(options)
    }

    const tsqFn = this.tsqueryFn(query)

    // $1 is always the query string
    const { conditions, params, nextIdx } = buildNoteConditions(options, 2)
    conditions.unshift(
      `(n.tsv @@ ${tsqFn}('english', $1) OR
        to_tsvector('english', coalesce(c.content, '')) @@ ${tsqFn}('english', $1))`,
    )
    // Prepend deleted_at check is already in buildNoteConditions
    const allParams = [query, ...params]
    let paramIdx = nextIdx

    const where = conditions.join(' AND ')

    // Total count
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${where}`,
      allParams,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    // Search with ts_rank and ts_headline
    const searchParams = [...allParams, limit, offset]
    const result = await this.db.query<{
      id: string
      title: string | null
      created_at: Date
      updated_at: Date
      rank: number
      snippet: string
    }>(
      `SELECT n.id, n.title, n.created_at, n.updated_at,
              ts_rank(
                setweight(n.tsv, 'A') || setweight(to_tsvector('english', coalesce(c.content, '')), 'B'),
                ${tsqFn}('english', $1)
              ) as rank,
              ts_headline(
                'english',
                coalesce(c.content, ''),
                ${tsqFn}('english', $1),
                'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
              ) as snippet
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${where}
       ORDER BY rank DESC, n.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      searchParams,
    )

    const resultIds = result.rows.map((r) => r.id)
    const [tagMap, embeddingSet] = await Promise.all([
      this.fetchTagMap(resultIds),
      this.fetchEmbeddingSet(resultIds),
    ])

    // Facets use full (unpaginated) result set
    let facets: SearchFacets | undefined
    if (options.include_facets) {
      const idsResult = await this.db.query<{ id: string }>(
        `SELECT n.id FROM note n
         LEFT JOIN note_revised_current c ON c.note_id = n.id
         WHERE ${where}`,
        allParams,
      )
      facets = await this.fetchFacets(idsResult.rows.map((r) => r.id))
    }

    const baseResults = result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: r.snippet ?? '',
      rank: r.rank,
      created_at: r.created_at,
      updated_at: r.updated_at,
      tags: tagMap.get(r.id) ?? [],
    }))

    return {
      results: this.attachEmbeddingStatus(baseResults, embeddingSet),
      total,
      query,
      mode: 'text',
      semantic_available: this.semanticAvailable,
      limit,
      offset,
      facets,
    }
  }

  /**
   * Semantic search using pgvector cosine distance.
   * Returns notes ranked by vector similarity to the query embedding.
   */
  async semanticSearch(
    queryEmbedding: number[],
    options: SearchOptions = {},
  ): Promise<SearchResponse> {
    const { limit = 20, offset = 0 } = options
    const vectorStr = `[${queryEmbedding.join(',')}]`

    // Filter conditions start at $1; vector/limit/offset appended after
    const { conditions, params, nextIdx } = buildNoteConditions(options, 1)
    let paramIdx = nextIdx

    const where = conditions.join(' AND ')

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       WHERE ${where}`,
      params,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const vecIdx = paramIdx++
    const limIdx = paramIdx++
    const offIdx = paramIdx++
    const result = await this.db.query<{
      id: string
      title: string | null
      created_at: Date
      updated_at: Date
      distance: number
      snippet: string
    }>(
      `SELECT n.id, n.title, n.created_at, n.updated_at,
              (e.vector <=> $${vecIdx}::vector) as distance,
              LEFT(coalesce(c.content, ''), 200) as snippet
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${where}
       ORDER BY e.vector <=> $${vecIdx}::vector ASC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      [...params, vectorStr, limit, offset],
    )

    const tagMap = await this.fetchTagMap(result.rows.map((r) => r.id))

    let facets: SearchFacets | undefined
    if (options.include_facets) {
      const idsResult = await this.db.query<{ id: string }>(
        `SELECT n.id FROM embedding e JOIN note n ON n.id = e.note_id WHERE ${where}`,
        params,
      )
      facets = await this.fetchFacets(idsResult.rows.map((r) => r.id))
    }

    return {
      results: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet ?? '',
        rank: 1 - r.distance, // Convert distance to similarity score
        created_at: r.created_at,
        updated_at: r.updated_at,
        tags: tagMap.get(r.id) ?? [],
        has_embedding: true, // Semantic results always have embeddings (JOIN on embedding table)
      })),
      total,
      query: '',
      mode: 'semantic',
      semantic_available: this.semanticAvailable,
      limit,
      offset,
      facets,
    }
  }

  /**
   * Hybrid search combining BM25 (full-text) and vector similarity using
   * Reciprocal Rank Fusion (RRF, k=60).
   */
  async hybridSearch(
    query: string,
    queryEmbedding: number[],
    options: SearchOptions = {},
  ): Promise<SearchResponse> {
    const { limit = 20, offset = 0 } = options
    const vectorStr = `[${queryEmbedding.join(',')}]`
    const k = 60
    const tsqFn = this.tsqueryFn(query)

    // Build shared conditions for text sub-query ($1 = query)
    const textCond = buildNoteConditions(options, 2)
    const textConditions = [
      ...textCond.conditions,
      `(n.tsv @@ ${tsqFn}('english', $1) OR
        to_tsvector('english', coalesce(c.content, '')) @@ ${tsqFn}('english', $1))`,
    ]
    const textWhere = textConditions.join(' AND ')
    const textParams = [query, ...textCond.params]

    // BM25 ranked note IDs (full-text)
    const textResult = await this.db.query<{ id: string; rank: number }>(
      `SELECT n.id,
              ts_rank(
                setweight(n.tsv, 'A') || setweight(to_tsvector('english', coalesce(c.content, '')), 'B'),
                ${tsqFn}('english', $1)
              ) as rank
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${textWhere}
       ORDER BY rank DESC
       LIMIT 100`,
      textParams,
    )

    // Build shared conditions for vector sub-query; conditions start at $1, vector appended after
    const vecCond = buildNoteConditions(options, 1)
    const vecWhere = vecCond.conditions.join(' AND ')
    const vecVecIdx = vecCond.nextIdx

    // Vector ranked note IDs
    const vectorResult = await this.db.query<{ id: string; distance: number }>(
      `SELECT n.id, (e.vector <=> $${vecVecIdx}::vector) as distance
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       WHERE ${vecWhere}
       ORDER BY e.vector <=> $${vecVecIdx}::vector ASC
       LIMIT 100`,
      [...vecCond.params, vectorStr],
    )

    // Build RRF scores
    const rrfScores = new Map<string, number>()

    textResult.rows.forEach((row, idx) => {
      const score = 1 / (k + idx + 1)
      rrfScores.set(row.id, (rrfScores.get(row.id) ?? 0) + score)
    })

    vectorResult.rows.forEach((row, idx) => {
      const score = 1 / (k + idx + 1)
      rrfScores.set(row.id, (rrfScores.get(row.id) ?? 0) + score)
    })

    // Sort by RRF score descending
    const sortedIds = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)

    const total = sortedIds.length
    const pageIds = sortedIds.slice(offset, offset + limit)

    if (pageIds.length === 0) {
      return {
        results: [],
        total,
        query,
        mode: 'hybrid',
        semantic_available: this.semanticAvailable,
        limit,
        offset,
      }
    }

    // Fetch full note data for the page
    const noteResult = await this.db.query<{
      id: string
      title: string | null
      created_at: Date
      updated_at: Date
      snippet: string
    }>(
      `SELECT n.id, n.title, n.created_at, n.updated_at,
              LEFT(coalesce(c.content, ''), 200) as snippet
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE n.id = ANY($1)`,
      [pageIds],
    )

    // Re-sort by RRF order
    const noteMap = new Map(noteResult.rows.map((r) => [r.id, r]))
    const [tagMap, embeddingSet] = await Promise.all([
      this.fetchTagMap(pageIds),
      this.fetchEmbeddingSet(pageIds),
    ])

    const facets = options.include_facets ? await this.fetchFacets(sortedIds) : undefined

    return {
      results: pageIds
        .map((id) => {
          const r = noteMap.get(id)
          if (!r) return null
          return {
            id: r.id,
            title: r.title,
            snippet: r.snippet ?? '',
            rank: rrfScores.get(id) ?? 0,
            created_at: r.created_at,
            updated_at: r.updated_at,
            tags: tagMap.get(id) ?? [],
            has_embedding: embeddingSet.has(id),
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
      total,
      query,
      mode: 'hybrid',
      semantic_available: this.semanticAvailable,
      limit,
      offset,
      facets,
    }
  }

  private async recentNotes(
    options: SearchOptions = {},
  ): Promise<SearchResponse> {
    const { limit = 20, offset = 0 } = options

    const { conditions, params, nextIdx } = buildNoteConditions(options, 1)
    let paramIdx = nextIdx

    const where = conditions.join(' AND ')

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM note n WHERE ${where}`,
      params,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const listParams = [...params, limit, offset]
    const result = await this.db.query<{
      id: string
      title: string | null
      created_at: Date
      updated_at: Date
      snippet: string
    }>(
      `SELECT n.id, n.title, n.created_at, n.updated_at,
              LEFT(coalesce(c.content, ''), 200) as snippet
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      listParams,
    )

    const resultIds = result.rows.map((r) => r.id)
    const embeddingSet = await this.fetchEmbeddingSet(resultIds)

    return {
      results: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet ?? '',
        rank: 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
        tags: [],
        has_embedding: embeddingSet.has(r.id),
      })),
      total,
      query: '',
      mode: 'text',
      semantic_available: this.semanticAvailable,
      limit,
      offset,
    }
  }

  /**
   * Fetch faceted aggregate counts for tags and collections across all matching note IDs.
   * Uses the full (unpaginated) result set for accurate counts.
   */
  private async fetchFacets(noteIds: string[]): Promise<SearchFacets> {
    if (noteIds.length === 0) {
      return { tags: [], collections: [] }
    }

    const [tagResult, collResult] = await Promise.all([
      this.db.query<{ tag: string; count: string }>(
        `SELECT nt.tag, COUNT(*) as count FROM note_tag nt
         WHERE nt.note_id = ANY($1) GROUP BY nt.tag ORDER BY count DESC LIMIT 20`,
        [noteIds],
      ),
      this.db.query<{ id: string; name: string; count: string }>(
        `SELECT col.id, col.name, COUNT(*) as count FROM collection_note cn
         JOIN collection col ON col.id = cn.collection_id
         WHERE cn.note_id = ANY($1) GROUP BY col.id, col.name ORDER BY count DESC LIMIT 20`,
        [noteIds],
      ),
    ])

    return {
      tags: tagResult.rows.map((r) => ({ tag: r.tag, count: parseInt(r.count, 10) })),
      collections: collResult.rows.map((r) => ({ id: r.id, name: r.name, count: parseInt(r.count, 10) })),
    }
  }

  private async fetchTagMap(noteIds: string[]): Promise<Map<string, string[]>> {
    const tagMap = new Map<string, string[]>()
    if (noteIds.length === 0) return tagMap

    const tagsResult = await this.db.query<{ note_id: string; tag: string }>(
      `SELECT note_id, tag FROM note_tag WHERE note_id = ANY($1) ORDER BY tag`,
      [noteIds],
    )
    for (const row of tagsResult.rows) {
      const existing = tagMap.get(row.note_id) ?? []
      existing.push(row.tag)
      tagMap.set(row.note_id, existing)
    }
    return tagMap
  }
}
