/**
 * searchTool — tool function wrapping SearchRepository.
 *
 * Text mode is always available. Semantic, hybrid, and auto modes are available
 * when the host passes a query_embedding; forced semantic/hybrid fail clearly
 * without one while auto falls back to lexical search.
 *
 * Input is Zod-validated at entry.
 */

import type { DatabaseClient } from '../storage-backend.js'
import { SearchRepository } from '../repositories/search-repository.js'
import { SearchInputSchema } from './schemas.js'
import type { SearchResponse } from '../repositories/types.js'

export async function searchTool(db: DatabaseClient, rawInput: unknown): Promise<SearchResponse> {
  const input = SearchInputSchema.parse(rawInput)
  const semanticAvailable = !!input.query_embedding?.length

  if ((input.mode === 'semantic' || input.mode === 'hybrid') && !semanticAvailable) {
    throw new Error(
      `Search mode '${input.mode}' requires query_embedding. semantic_available: false`,
    )
  }

  const repo = new SearchRepository(db, semanticAvailable)
  return repo.search(input.query, {
    limit: input.limit,
    offset: input.offset,
    mode: input.mode,
    tags: input.tags,
    collection_id: input.collection_id,
    date_from: input.date_from,
    date_to: input.date_to,
    is_starred: input.is_starred,
    is_archived: input.is_archived,
    format: input.format,
    source: input.source,
    visibility: input.visibility,
    include_facets: input.include_facets,
    embeddingSetId: input.embeddingSetId,
  }, input.query_embedding)
}
