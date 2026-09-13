/**
 * SearchRepository - full-text search using DatabaseClient tsvector/tsquery,
 * with optional semantic search (pgvector) and hybrid (BM25 + vector RRF).
 */

import type { DatabaseClient } from '../storage-backend.js'
import type { SearchResponse, SearchOptions, SearchFacets, SearchResult } from './types.js'
import { resolveStoredSearchEvidence, type SearchEvidenceScope } from './search-evidence-repository.js'
import { buildSearchEvidenceProjection, projectedSearchEvidence, type ProjectedSearchEvidence } from './search-evidence-projection.js'
import { mergeSearchEvidenceSets } from '../search-evidence-set.js'
import { buildNoteConditions } from './condition-builder.js'
import { EmbeddingSetsRepository, type EmbeddingSetSelector, type ResolvedEmbeddingSet } from './embedding-sets-repository.js'
import { buildMetadataPredicateConditions, buildMetadataSourceConditions, validateMetadataPredicates, type EvidenceLocator, type RegisteredMetadataPath } from './metadata-predicates.js'

const ATTACHMENT_TEXT_JOIN = `
       LEFT JOIN (
         SELECT note_id,
                string_agg(extracted_text, ' ' ORDER BY position, created_at)
                  FILTER (WHERE extracted_text IS NOT NULL AND extracted_text <> '') as extracted_text
         FROM attachment
         WHERE deleted_at IS NULL AND status = 'completed'
         GROUP BY note_id
       ) ax ON ax.note_id = n.id`
const COMBINED_TEXT_SQL = `trim(both from (coalesce(c.content, '') || ' ' || coalesce(ax.extracted_text, '')))`
const COMBINED_TEXT_VECTOR_SQL = `to_tsvector('english', ${COMBINED_TEXT_SQL})`

function vectorColumn(query: number[]): string {
  if (query.length === 0 || !query.every(Number.isFinite)) throw new Error('Query embedding must be a nonempty finite vector')
  // Match the partial expression indexes for the local and producer dimensions.
  return query.length === 384 || query.length === 768 ? `e.vector::vector(${query.length})` : 'e.vector'
}

export class SearchRepository {
  constructor(
    private db: DatabaseClient,
    private semanticAvailable = false,
  ) {}

  /** Candidate citation resolution with fresh local scope and content checks. */
  async resolveEvidence(locator: unknown, scope: SearchEvidenceScope = {}): Promise<string> {
    return resolveStoredSearchEvidence(this.db, locator, scope)
  }

  private tsqueryFn(query: string): 'phraseto_tsquery' | 'plainto_tsquery' {
    return query.includes('"') ? 'phraseto_tsquery' : 'plainto_tsquery'
  }

  private async fetchEmbeddingSet(noteIds: string[], embeddingSetId?: string): Promise<Set<string>> {
    if (noteIds.length === 0) return new Set()
    const params: unknown[] = [noteIds]
    const setFilter = embeddingSetId ? ' AND embedding_set_id = $2' : ''
    if (embeddingSetId) params.push(embeddingSetId)
    const result = await this.db.query<{ note_id: string }>(
      'SELECT to_jsonb(note_id) AS note_id FROM embedding WHERE vector IS NOT NULL AND note_id = ANY($1)' + setFilter,
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
    // A selector chooses one source set per note, not one arbitrary chunk.
    // Keep that policy while allowing every chunk of the selected note/set pair.
    conditions.push(`EXISTS (SELECT 1 FROM jsonb_to_recordset($${paramIdx}::jsonb)
      AS selected(note_id text, embedding_set_id text)
      WHERE selected.note_id = e.note_id AND selected.embedding_set_id = e.embedding_set_id)`)
    params.push(JSON.stringify(resolved.rows.map((row) => ({ note_id: row.note_id, embedding_set_id: row.embedding_set_id }))))
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

  private async fetchLocatorMap(
    noteIds: string[],
    options: SearchOptions,
  ): Promise<Map<string, EvidenceLocator[]>> {
    const locators = new Map<string, EvidenceLocator[]>()
    if (noteIds.length === 0) return locators
    const metadataPaths = this.metadataPaths(options)
    const source = buildMetadataSourceConditions(options, 2)
    const result = await this.db.query<{
      note_id: string
      namespace: string
      external_id_hash: string
      import_run_id: string
      source_schema_version: string
    }>(
      `SELECT to_jsonb(si.note_id) AS note_id, si.namespace, si.external_id_hash, si.import_run_id, si.source_schema_version
       FROM source_identity si JOIN note n ON n.id = si.note_id
       WHERE n.id = ANY($1) AND ${source.conditions.join(' AND ')}
       ORDER BY si.created_at ASC, si.id ASC`,
      [noteIds, ...source.params],
    )
    for (const row of result.rows) {
      const existing = locators.get(row.note_id) ?? []
      existing.push({
        note_id: row.note_id,
        chunk: { kind: 'current', index: 0 },
        source: {
          namespace: row.namespace,
          external_id_hash: row.external_id_hash,
          import_run_id: row.import_run_id,
          schema_version: row.source_schema_version,
        },
        metadata_paths: [...metadataPaths],
      })
      locators.set(row.note_id, existing)
    }
    for (const noteId of noteIds) {
      if (!locators.has(noteId)) {
        locators.set(noteId, [{ note_id: noteId, chunk: { kind: 'current', index: 0 }, metadata_paths: [...metadataPaths] }])
      }
    }
    return locators
  }

  private metadataPaths(options: SearchOptions): RegisteredMetadataPath[] {
    return [...new Set((options.metadataPredicates ?? []).map((predicate) => predicate.path))]
  }

  async search(
    query: string,
    options: SearchOptions = {},
    queryEmbedding?: number[],
  ): Promise<SearchResponse> {
    validateMetadataPredicates(options.metadataPredicates === undefined ? [] : options.metadataPredicates)
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
    const metadata = buildMetadataPredicateConditions(options, nextIdx)
    conditions.push(...metadata.conditions)
    params.push(...metadata.params)
    conditions.unshift(
      `(n.tsv @@ ${tsqFn}('english', $1) OR
        ${COMBINED_TEXT_VECTOR_SQL} @@ ${tsqFn}('english', $1))`,
    )
    let paramIdx = this.scopeToResolvedEmbeddingSet(conditions, params, metadata.nextIdx, resolvedEmbeddingSet)
    const allParams = [query, ...params]
    const where = conditions.join(' AND ')

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${metadata.joins.join('\n')}
       ${ATTACHMENT_TEXT_JOIN}
       WHERE ${where}`,
      allParams,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const evidence = buildSearchEvidenceProjection(options, paramIdx, { lexical: { fn: tsqFn, parameter: 1 } })
    paramIdx = evidence.nextIdx
    const searchParams = [...allParams, ...evidence.params, limit, offset]
    const result = await this.db.query<{
      id: string
      title: string | null
      created_at: Date
      updated_at: Date
      rank: number
      snippet: string
      evidence_projection: ProjectedSearchEvidence
    }>(
      `SELECT to_jsonb(n.id) AS id, n.title, n.created_at, n.updated_at, ${evidence.sql} AS evidence_projection,
              ts_rank(
                setweight(n.tsv, 'A') || setweight(${COMBINED_TEXT_VECTOR_SQL}, 'B'),
                ${tsqFn}('english', $1)
              ) as rank,
              ts_headline(
                'english',
                ${COMBINED_TEXT_SQL},
                ${tsqFn}('english', $1),
                'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
              ) as snippet
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${metadata.joins.join('\n')}
       ${ATTACHMENT_TEXT_JOIN}
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
        `SELECT to_jsonb(n.id) AS id FROM note n
         LEFT JOIN note_revised_current c ON c.note_id = n.id
         ${metadata.joins.join('\n')}
         ${ATTACHMENT_TEXT_JOIN}
         WHERE ${where}`,
        allParams,
      )
      facets = await this.fetchFacets(idsResult.rows.map((r) => r.id))
    }

    const locatorMap = await this.fetchLocatorMap(resultIds, options)
    const baseResults = result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      snippet: r.snippet ?? '',
      rank: r.rank,
      created_at: r.created_at,
      updated_at: r.updated_at,
      tags: tagMap.get(r.id) ?? [],
      locators: locatorMap.get(r.id) ?? [],
      evidence: projectedSearchEvidence(r.id, r.evidence_projection),
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
    validateMetadataPredicates(options.metadataPredicates === undefined ? [] : options.metadataPredicates)
    const { limit = 20, offset = 0 } = options
    const vector = vectorColumn(queryEmbedding)
    const vectorStr = `[${queryEmbedding.join(',')}]`
    const resolvedEmbeddingSet = await this.resolveEmbeddingSet(options)
    const { conditions, params, nextIdx } = buildNoteConditions(options, 1)
    const metadata = buildMetadataPredicateConditions(options, nextIdx)
    conditions.push(...metadata.conditions)
    params.push(...metadata.params)
    let paramIdx = this.scopeToResolvedEmbeddingRows(conditions, params, metadata.nextIdx, resolvedEmbeddingSet)
    conditions.push(`vector_dims(e.vector) = ${queryEmbedding.length}`)
    const where = conditions.join(' AND ')

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT n.id) as count
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${metadata.joins.join('\n')}
       WHERE ${where}`,
      params,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const evidence = buildSearchEvidenceProjection(options, paramIdx, { embedding: true })
    paramIdx = evidence.nextIdx
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
      evidence_projection: ProjectedSearchEvidence
    }>(
      `SELECT * FROM (SELECT DISTINCT ON (n.id) to_jsonb(n.id) AS id, n.title, n.created_at, n.updated_at,
              ${evidence.sql} AS evidence_projection,
              (${vector} <=> $${vecIdx}::vector) as distance,
              LEFT(${COMBINED_TEXT_SQL}, 200) as snippet
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${metadata.joins.join('\n')}
       ${ATTACHMENT_TEXT_JOIN}
       WHERE ${where}
       ORDER BY n.id, ${vector} <=> $${vecIdx}::vector ASC, e.id) AS best_chunks
       ORDER BY distance ASC, id
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      [...params, ...evidence.params, vectorStr, limit, offset],
    )

    const tagMap = await this.fetchTagMap(result.rows.map((r) => r.id))
    const facets = options.include_facets
      ? await this.fetchFacets((await this.db.query<{ id: string }>(
          `SELECT to_jsonb(n.id) AS id
           FROM embedding e
           JOIN note n ON n.id = e.note_id
           LEFT JOIN note_revised_current c ON c.note_id = n.id
           ${metadata.joins.join('\n')}
           WHERE ${where}`,
          params,
        )).rows.map((r) => r.id))
      : undefined
    const locatorMap = await this.fetchLocatorMap(result.rows.map((r) => r.id), options)

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
        locators: locatorMap.get(r.id) ?? [],
        evidence: projectedSearchEvidence(r.id, r.evidence_projection),
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
    validateMetadataPredicates(options.metadataPredicates === undefined ? [] : options.metadataPredicates)
    const { limit = 20, offset = 0 } = options
    const vectorStr = `[${queryEmbedding.join(',')}]`
    const k = 60
    const tsqFn = this.tsqueryFn(query)
    const resolvedEmbeddingSet = await this.resolveEmbeddingSet(options)

    const textCond = buildNoteConditions(options, 2)
    const textMeta = buildMetadataPredicateConditions(options, textCond.nextIdx)
    const textConditions = [
      ...textCond.conditions,
      ...textMeta.conditions,
      `(n.tsv @@ ${tsqFn}('english', $1) OR
        ${COMBINED_TEXT_VECTOR_SQL} @@ ${tsqFn}('english', $1))`,
    ]
    textCond.params.push(...textMeta.params)
    const textNextIdx = this.scopeToResolvedEmbeddingSet(textConditions, textCond.params, textMeta.nextIdx, resolvedEmbeddingSet)
    const textWhere = textConditions.join(' AND ')
    const textEvidence = buildSearchEvidenceProjection(options, textNextIdx, { lexical: { fn: tsqFn, parameter: 1 } })
    const textParams = [query, ...textCond.params, ...textEvidence.params]

    const textResult = await this.db.query<{ id: string; rank: number; evidence_projection: ProjectedSearchEvidence }>(
      `SELECT to_jsonb(n.id) AS id, ${textEvidence.sql} AS evidence_projection,
              ts_rank(
                setweight(n.tsv, 'A') || setweight(${COMBINED_TEXT_VECTOR_SQL}, 'B'),
                ${tsqFn}('english', $1)
              ) as rank
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${textMeta.joins.join('\n')}
       ${ATTACHMENT_TEXT_JOIN}
       WHERE ${textWhere}
       ORDER BY rank DESC
       LIMIT 100`,
      textParams,
    )

    const vecCond = buildNoteConditions(options, 1)
    const vecMeta = buildMetadataPredicateConditions(options, vecCond.nextIdx)
    vecCond.conditions.push(...vecMeta.conditions)
    vecCond.params.push(...vecMeta.params)
    vecCond.nextIdx = this.scopeToResolvedEmbeddingRows(vecCond.conditions, vecCond.params, vecMeta.nextIdx, resolvedEmbeddingSet)
    const vector = vectorColumn(queryEmbedding)
    vecCond.conditions.push(`vector_dims(e.vector) = ${queryEmbedding.length}`)
    const vecWhere = vecCond.conditions.join(' AND ')
    const vectorEvidence = buildSearchEvidenceProjection(options, vecCond.nextIdx, { embedding: true })
    const vecVecIdx = vectorEvidence.nextIdx

    const vectorResult = await this.db.query<{ id: string; distance: number; evidence_projection: ProjectedSearchEvidence }>(
      `SELECT * FROM (SELECT DISTINCT ON (n.id) to_jsonb(n.id) AS id, ${vectorEvidence.sql} AS evidence_projection,
              (${vector} <=> $${vecVecIdx}::vector) as distance
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${vecMeta.joins.join('\n')}
       WHERE ${vecWhere}
       ORDER BY n.id, ${vector} <=> $${vecVecIdx}::vector ASC, e.id) AS best_chunks
       ORDER BY distance ASC, id
       LIMIT 100`,
      [...vecCond.params, ...vectorEvidence.params, vectorStr],
    )

    const rrfScores = new Map<string, number>()
    const evidenceMap = new Map<string, ReturnType<typeof projectedSearchEvidence>[]>()
    for (const row of [...textResult.rows, ...vectorResult.rows]) {
      const existing = evidenceMap.get(row.id) ?? []
      existing.push(projectedSearchEvidence(row.id, row.evidence_projection))
      evidenceMap.set(row.id, existing)
    }
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

    const displayConditions = buildNoteConditions(options, 2)
    const displayMetadata = buildMetadataPredicateConditions(options, displayConditions.nextIdx)
    const noteResult = await this.db.query<{
      id: string
      title: string | null
      created_at: Date
      updated_at: Date
      snippet: string
    }>(
      `SELECT to_jsonb(n.id) AS id, n.title, n.created_at, n.updated_at,
              LEFT(${COMBINED_TEXT_SQL}, 200) as snippet
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${ATTACHMENT_TEXT_JOIN}
       ${displayMetadata.joins.join('\n')}
       WHERE n.id = ANY($1) AND ${[...displayConditions.conditions, ...displayMetadata.conditions].join(' AND ')}`,
      [pageIds, ...displayConditions.params, ...displayMetadata.params],
    )

    const noteMap = new Map(noteResult.rows.map((r) => [r.id, r]))
    const [tagMap, embeddingSet] = await Promise.all([
      this.fetchTagMap(pageIds),
      this.fetchEmbeddingStatus(pageIds, resolvedEmbeddingSet, options.embeddingSetId),
    ])
    const locatorMap = await this.fetchLocatorMap(pageIds, options)
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
            locators: locatorMap.get(id) ?? [],
            evidence: mergeSearchEvidenceSets(id, evidenceMap.get(id) ?? []),
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
    const metadata = buildMetadataPredicateConditions(options, nextIdx)
    conditions.push(...metadata.conditions)
    params.push(...metadata.params)
    let paramIdx = this.scopeToResolvedEmbeddingSet(conditions, params, metadata.nextIdx, resolvedEmbeddingSet)
    const where = conditions.join(' AND ')

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${metadata.joins.join('\n')}
       WHERE ${where}`,
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
      `SELECT to_jsonb(n.id) AS id, n.title, n.created_at, n.updated_at,
              LEFT(${COMBINED_TEXT_SQL}, 200) as snippet
       FROM note n
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${metadata.joins.join('\n')}
       ${ATTACHMENT_TEXT_JOIN}
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      listParams,
    )

    const resultIds = result.rows.map((r) => r.id)
    const embeddingSet = await this.fetchEmbeddingStatus(resultIds, resolvedEmbeddingSet, options.embeddingSetId)
    const locatorMap = await this.fetchLocatorMap(resultIds, options)

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
        locators: locatorMap.get(r.id) ?? [],
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
      `SELECT to_jsonb(note_id) AS note_id, tag FROM note_tag WHERE note_id = ANY($1) ORDER BY tag`,
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
