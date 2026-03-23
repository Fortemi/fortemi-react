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
 *
 * @implements #64 semantic and hybrid search
 */

import type { PGlite } from '@electric-sql/pglite'
import type { SearchResponse, SearchOptions } from './types.js'

export class SearchRepository {
  constructor(
    private db: PGlite,
    private semanticAvailable = false,
  ) {}

  async search(
    query: string,
    options: SearchOptions = {},
    queryEmbedding?: number[],
  ): Promise<SearchResponse> {
    const { limit = 20, offset = 0, tags, collection_id } = options

    // Dispatch to semantic or hybrid if embedding is provided
    if (queryEmbedding && queryEmbedding.length > 0) {
      if (query.trim()) {
        return this.hybridSearch(query, queryEmbedding, options)
      }
      return this.semanticSearch(queryEmbedding, options)
    }

    if (!query.trim()) {
      return this.recentNotes(limit, offset, tags, collection_id)
    }

    const conditions: string[] = [
      'n.deleted_at IS NULL',
      `(n.tsv @@ plainto_tsquery('english', $1) OR
        to_tsvector('english', coalesce(c.content, '')) @@ plainto_tsquery('english', $1))`,
    ]
    const params: unknown[] = [query]
    let paramIdx = 2

    if (tags?.length) {
      conditions.push(
        `EXISTS (SELECT 1 FROM note_tag nt WHERE nt.note_id = n.id AND nt.tag = ANY($${paramIdx++}))`,
      )
      params.push(tags)
    }
    if (collection_id) {
      conditions.push(
        `EXISTS (SELECT 1 FROM collection_note cn WHERE cn.note_id = n.id AND cn.collection_id = $${paramIdx++})`,
      )
      params.push(collection_id)
    }

    const where = conditions.join(' AND ')

    // Total count
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${where}`,
      params,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    // Search with ts_rank and ts_headline
    const searchParams = [...params, limit, offset]
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
                plainto_tsquery('english', $1)
              ) as rank,
              ts_headline(
                'english',
                coalesce(c.content, ''),
                plainto_tsquery('english', $1),
                'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
              ) as snippet
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${where}
       ORDER BY rank DESC, n.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      searchParams,
    )

    const tagMap = await this.fetchTagMap(result.rows.map((r) => r.id))

    return {
      results: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet ?? '',
        rank: r.rank,
        created_at: r.created_at,
        updated_at: r.updated_at,
        tags: tagMap.get(r.id) ?? [],
      })),
      total,
      query,
      mode: 'text',
      semantic_available: this.semanticAvailable,
      limit,
      offset,
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

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       WHERE n.deleted_at IS NULL`,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await this.db.query<{
      id: string
      title: string | null
      created_at: Date
      updated_at: Date
      distance: number
      snippet: string
    }>(
      `SELECT n.id, n.title, n.created_at, n.updated_at,
              (e.vector <=> $1::vector) as distance,
              LEFT(coalesce(c.content, ''), 200) as snippet
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE n.deleted_at IS NULL
       ORDER BY e.vector <=> $1::vector ASC
       LIMIT $2 OFFSET $3`,
      [vectorStr, limit, offset],
    )

    const tagMap = await this.fetchTagMap(result.rows.map((r) => r.id))

    return {
      results: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet ?? '',
        rank: 1 - r.distance, // Convert distance to similarity score
        created_at: r.created_at,
        updated_at: r.updated_at,
        tags: tagMap.get(r.id) ?? [],
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

    // BM25 ranked note IDs (full-text)
    const textResult = await this.db.query<{ id: string; rank: number }>(
      `SELECT n.id,
              ts_rank(
                setweight(n.tsv, 'A') || setweight(to_tsvector('english', coalesce(c.content, '')), 'B'),
                plainto_tsquery('english', $1)
              ) as rank
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE n.deleted_at IS NULL
         AND (n.tsv @@ plainto_tsquery('english', $1) OR
              to_tsvector('english', coalesce(c.content, '')) @@ plainto_tsquery('english', $1))
       ORDER BY rank DESC
       LIMIT 100`,
      [query],
    )

    // Vector ranked note IDs
    const vectorResult = await this.db.query<{ id: string; distance: number }>(
      `SELECT n.id, (e.vector <=> $1::vector) as distance
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       WHERE n.deleted_at IS NULL
       ORDER BY e.vector <=> $1::vector ASC
       LIMIT 100`,
      [vectorStr],
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
        mode: 'text',
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
    const tagMap = await this.fetchTagMap(pageIds)

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
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
      total,
      query,
      mode: 'text',
      semantic_available: this.semanticAvailable,
      limit,
      offset,
    }
  }

  private async recentNotes(
    limit: number,
    offset: number,
    tags?: string[],
    collection_id?: string,
  ): Promise<SearchResponse> {
    const conditions: string[] = ['n.deleted_at IS NULL']
    const params: unknown[] = []
    let paramIdx = 1

    if (tags?.length) {
      conditions.push(
        `EXISTS (SELECT 1 FROM note_tag nt WHERE nt.note_id = n.id AND nt.tag = ANY($${paramIdx++}))`,
      )
      params.push(tags)
    }
    if (collection_id) {
      conditions.push(
        `EXISTS (SELECT 1 FROM collection_note cn WHERE cn.note_id = n.id AND cn.collection_id = $${paramIdx++})`,
      )
      params.push(collection_id)
    }

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

    return {
      results: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet ?? '',
        rank: 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
        tags: [],
      })),
      total,
      query: '',
      mode: 'text',
      semantic_available: this.semanticAvailable,
      limit,
      offset,
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
