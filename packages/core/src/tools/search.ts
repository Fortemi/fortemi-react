/**
 * searchTool — tool function wrapping SearchRepository.
 *
 * Only 'text' mode is currently supported. Semantic and hybrid modes throw a
 * descriptive error so callers can surface appropriate feedback.
 *
 * Input is Zod-validated at entry.
 */

import type { PGlite } from '@electric-sql/pglite'
import { SearchRepository } from '../repositories/search-repository.js'
import { SearchInputSchema } from './schemas.js'
import type { SearchResponse } from '../repositories/types.js'

export async function searchTool(db: PGlite, rawInput: unknown): Promise<SearchResponse> {
  const input = SearchInputSchema.parse(rawInput)

  if (input.mode !== 'text') {
    throw new Error(
      `Search mode '${input.mode}' is not available. Only 'text' mode is currently supported. semantic_available: false`,
    )
  }

  const repo = new SearchRepository(db)
  return repo.search(input.query, {
    limit: input.limit,
    offset: input.offset,
    tags: input.tags,
    collection_id: input.collection_id,
  })
}
