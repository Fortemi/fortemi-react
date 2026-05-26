/**
 * SearchRepository - full-text search using DatabaseClient tsvector/tsquery,
 * with optional semantic search (pgvector) and hybrid (BM25 + vector RRF).
 */

import type { DatabaseClient } from '../storage-backend.js'
import type { SearchResponse, SearchOptions, SearchFacets, SearchResult } from './types.js'
import { buildNoteConditions } from './condition-builder.js'
import { EmbeddingSetsRepository, type EmbeddingSetSelector, type ResolvedEmbeddingSet } from './embedding-sets-repository.js'

export class SearchRepository {
  constructor(
    private db: DatabaseClient,
    private semanticAvailable = false,
  ) {}

  private tsqueryFn(query: string): string {
    return query.includes('"') ? 'phraseto_tsquery' : 'plainto_tsquery'
  }

  private async fetchEmbeddingSet(noteIds: string[], embeddingSetId?: string): Promise<Set<string>> {
    if (noteIds.length === 0) return new Set()
    const params: unknown[] = [noteIds]
    const setFilter = embeddingSetId ? ' AND embedding_set_id = $2' : ''
    if (embeddingSetId) params.push(embeddingSetId)
    const result = await this.db.query<{ note_id: string }>(
      'SELECT note_id FROM embedding WHERE note_id = ANY($1)' + setFilter,
      params,
    )
    return new Set(result.rows.map((r) => r.note_id))
  }

  private selectorFromOptions(options: SearchOptions): EmbeddingSetSelector | null {
    if (options.embeddingSetSelector) return options.embeddingSetSelector
    if (options.embeddingSetId) return { kind: 'embedding-set', embeddingSetId: options.embeddingSetId }
    return null
  }

  private async resolveEmbeddingSet(options: SearchOptions): Promise<ResolvedEmbeddingSet | null> {
    const selector = this.selectorFromOptions(options)
    if (!selector) return null
    return new EmbeddingSetsRepository(this.db).resolveSelector(selector)
  }

  private scopeToResolvedEmbeddingSet(
    conditions: string[],
    params: unknown[],
    paramIdx: number,
    resolved: ResolvedEmbeddingSet | null,
  ): number {
    if (!resolved) return paramIdx
    if (resolved.noteIds.length === 0) {
      conditions.push('FALSE')
      return paramIdx
    }
    conditions.push('n.id = ANY($' + paramIdx + ')')
    params.push(resolved.noteIds)
    return paramIdx + 1
  }

  private scopeToResolvedEmbeddingRows(
    conditions: string[],
    params: unknown[],
    paramIdx: number,
    resolved: ResolvedEmbeddingSet | null,
  ): number {
    if (!resolved) return paramIdx
    if (resolved.embeddingIds.length === 0) {
      conditions.push('FALSE')
      return paramIdx
    }
    conditions.push('e.id = ANY($' + paramIdx + ')')
    params.push(resolved.embeddingIds)
    return paramIdx + 1
  }

  private async fetchEmbeddingStatus(
    noteIds: string[],
    resolved: ResolvedEmbeddingSet | null,
    embeddingSetId?: string,
  ): Promise<Set<string>> {
    if (resolved) return new Set(noteIds.filter((id) => resolved.noteIds.includes(id)))
    return this.fetchEmbeddingSet(noteIds, embeddingSetId)
  }

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

    if (mode === 'text') {
      if (!query.trim()) return this.recentNotes(options)
    } else if (mode === 'semantic') {
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error('mode=semantic requires a query embedding')
      }
      return this.semanticSearch(queryEmbedding, options)
    } else if (mode === 'hybrid') {
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error('mode=hybrid requires a query embedding')
      }
      return this.hybridSearch(query, queryEmbedding, options)
    } else {
      if (queryEmbedding && queryEmbedding.length > 0) {
        if (query.trim()) return this.hybridSearch(query, queryEmbedding, options)
        return this.semanticSearch(queryEmbedding, options)
      }
      if (!query.trim()) return this.recentNotes(options)
    }

    if (!query.trim()) return this.recentNotes(options)

    const resolvedEmbeddingSet = await this.resolveEmbeddingSet(options)
    const tsqFn = this.tsqueryFn(query)
    const { conditions, params, nextIdx } = buildNoteConditions(options, 2)
    conditions.unshift(
      `(n.tsv @@ ${tsqFn}('english', $1) OR
        to_tsvector('english', coalesce(c.content, '')) @@ ${tsqFn}('english', $1))`,
    )
    let paramIdx = this.scopeToResolvedEmbeddingSet(conditions, params, nextIdx, resolvedEmbeddingSet)
    const allParams = [query, ...params]
    const where = conditions.join(' AND ')

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE ${where}`,
      allParams,
    )
    const total = parseInt(countResult.rows[0].count, 10)

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
      this.fetchEmbeddingStatus(resultIds, resolvedEmbeddingSet, options.embeddingSetId),
    ])

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

  async semanticSearch(queryEmbedding: number[], options: SearchOptions = {}): Promise<SearchResponse> {
    const { limit = 20, offset = 0 } = options
    const vectorStr = `[${queryEmbedding.join(',')}]`
    const resolvedEmbeddingSet = await this.resolveEmbeddingSet(options)
    const { conditions, params, nextIdx } = buildNoteConditions(options, 1)
    let paramIdx = this.scopeToResolvedEmbeddingRows(conditions, params, nextIdx, resolvedEmbeddingSet)
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
    const facets = options.include_facets
      ? await this.fetchFacets((await this.db.query<{ id: string }>(
          `SELECT n.id FROM embedding e JOIN note n ON n.id = e.note_id WHERE ${where}`,
          params,
        )).rows.map((r) => r.id))
      : undefined

    return {
      results: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet ?? '',
        rank: 1 - r.distance,
        created_at: r.created_at,
        updated_at: r.updated_at,
        tags: tagMap.get(r.id) ?? [],
        has_embedding: true,
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

  async hybridSearch(
    query: string,
    queryEmbedding: number[],
    options: SearchOptions = {},
  ): Promise<SearchResponse> {
    const { limit = 20, offset = 0 } = options
    const vectorStr = `[${queryEmbedding.join(',')}]`
    const k = 60
    const tsqFn = this.tsqueryFn(query)
    const resolvedEmbeddingSet = await this.resolveEmbeddingSet(options)

    const textCond = buildNoteConditions(options, 2)
    const textConditions = [
      ...textCond.conditions,
      `(n.tsv @@ ${tsqFn}('english', $1) OR
        to_tsvector('english', coalesce(c.content, '')) @@ ${tsqFn}('english', $1))`,
    ]
    this.scopeToResolvedEmbeddingSet(textConditions, textCond.params, textCond.nextIdx, resolvedEmbeddingSet)
    const textWhere = textConditions.join(' AND ')
    const textParams = [query, ...textCond.params]

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

    const vecCond = buildNoteConditions(options, 1)
    vecCond.nextIdx = this.scopeToResolvedEmbeddingRows(vecCond.conditions, vecCond.params, vecCond.nextIdx, resolvedEmbeddingSet)
    const vecWhere = vecCond.conditions.join(' AND ')
    const vecVecIdx = vecCond.nextIdx

    const vectorResult = await this.db.query<{ id: string; distance: number }>(
      `SELECT n.id, (e.vector <=> $${vecVecIdx}::vector) as distance
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       WHERE ${vecWhere}
       ORDER BY e.vector <=> $${vecVecIdx}::vector ASC
       LIMIT 100`,
      [...vecCond.params, vectorStr],
    )

    const rrfScores = new Map<string, number>()
    textResult.rows.forEach((row, idx) => {
      rrfScores.set(row.id, (rrfScores.get(row.id) ?? 0) + 1 / (k + idx + 1))
    })
    vectorResult.rows.forEach((row, idx) => {
      rrfScores.set(row.id, (rrfScores.get(row.id) ?? 0) + 1 / (k + idx + 1))
    })

    const sortedIds = Array.from(rrfScores.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    const total = sortedIds.length
    const pageIds = sortedIds.slice(offset, offset + limit)

    if (pageIds.length === 0) {
      return { results: [], total, query, mode: 'hybrid', semantic_available: this.semanticAvailable, limit, offset }
    }

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

    const noteMap = new Map(noteResult.rows.map((r) => [r.id, r]))
    const [tagMap, embeddingSet] = await Promise.all([
      this.fetchTagMap(pageIds),
      this.fetchEmbeddingStatus(pageIds, resolvedEmbeddingSet, options.embeddingSetId),
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

  private async recentNotes(options: SearchOptions = {}): Promise<SearchResponse> {
    const { limit = 20, offset = 0 } = options
    const resolvedEmbeddingSet = await this.resolveEmbeddingSet(options)
    const { conditions, params, nextIdx } = buildNoteConditions(options, 1)
    let paramIdx = this.scopeToResolvedEmbeddingSet(conditions, params, nextIdx, resolvedEmbeddingSet)
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
    const embeddingSet = await this.fetchEmbeddingStatus(resultIds, resolvedEmbeddingSet, options.embeddingSetId)

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

  private async fetchFacets(noteIds: string[]): Promise<SearchFacets> {
    if (noteIds.length === 0) return { tags: [], collections: [] }

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
