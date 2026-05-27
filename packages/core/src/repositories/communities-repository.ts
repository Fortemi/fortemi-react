import type { DatabaseClient } from '../storage-backend.js'
import { generateId } from '../uuid.js'
import type { EmbeddingSetSelector } from './embedding-sets-repository.js'
import { SearchRepository } from './search-repository.js'

export type CommunitySourceType =
  | 'computed'
  | 'precomputed'
  | 'dynamic'
  | 'dynamic-snapshot'
  | 'user-authored'
  | 'imported'

export interface CommunityFilterDefinition {
  query?: string
  tags?: string[]
  collectionIds?: string[]
  conceptIds?: string[]
  noteIds?: string[]
  embeddingSetSelector?: EmbeddingSetSelector
}

export interface CommunitySourceDescriptor {
  id: string
  name: string
  sourceType: CommunitySourceType
  graphSourceId?: string
  selector?: EmbeddingSetSelector
  searchQuery?: string
  filters?: CommunityFilterDefinition
  createdAt?: string
  updatedAt?: string
  freshness?: 'fresh' | 'stale' | 'unknown'
}

export interface CommunityAssignmentView {
  communitySourceId: string
  communityId: string
  noteId: string
  label?: string | null
  confidence?: number | null
  sourceType: CommunitySourceType
}

export interface CommunitySummary {
  id: string
  label: string
  sourceType: CommunitySourceType
  size: number
  confidence?: number | null
  representativeNoteIds: string[]
  freshness?: 'fresh' | 'stale' | 'unknown'
}

export interface CommunityCreateInput {
  name: string
  label?: string
  sourceType: 'dynamic-snapshot' | 'user-authored'
  filters?: CommunityFilterDefinition
  noteIds?: string[]
  representativeNoteIds?: string[]
}

function json(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value)
}

function parseObject<T>(value: unknown): T | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function iso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : value
}

export class CommunitiesRepository {
  constructor(private db: DatabaseClient) {}

  async previewDynamicCommunity(filters: CommunityFilterDefinition): Promise<CommunityAssignmentView[]> {
    const noteIds = await this.resolveFilterNoteIds(filters)
    return noteIds.map((noteId) => ({
      communitySourceId: 'dynamic-preview',
      communityId: 'dynamic-preview',
      noteId,
      label: 'Dynamic preview',
      confidence: null,
      sourceType: 'dynamic',
    }))
  }

  async saveCommunity(input: CommunityCreateInput): Promise<CommunitySourceDescriptor> {
    const sourceId = generateId()
    const communitySetId = generateId()
    const communityId = generateId()
    const noteIds = input.noteIds ?? (input.filters ? await this.resolveFilterNoteIds(input.filters) : [])
    const sourceKind = input.sourceType === 'dynamic-snapshot' ? 'search' : 'manual'
    const freshness = input.sourceType === 'dynamic-snapshot' ? 'fresh' : 'unknown'

    await this.db.query(
      `INSERT INTO graph_source (id, name, kind, source_table, parameters_json, input_hash, freshness_json)
       VALUES ($1, $2, $3, 'manual', $4::jsonb, $5, $6::jsonb)`,
      [sourceId, input.name, sourceKind, json({ filters: input.filters ?? null }), `community:${sourceId}`, json({ status: freshness })],
    )
    await this.db.query(
      `INSERT INTO community_set (id, graph_source_id, name, source_type, parameters_json, input_hash, freshness_json)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)`,
      [communitySetId, sourceId, input.name, input.sourceType, json({ filters: input.filters ?? null }), `community:${communitySetId}`, json({ status: freshness })],
    )
    await this.db.query(
      `INSERT INTO community (community_set_id, id, label, rank, size, representative_note_ids)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [communitySetId, communityId, input.label ?? input.name, noteIds.length, input.representativeNoteIds ?? []],
    )
    for (const noteId of noteIds) {
      await this.db.query(
        `INSERT INTO community_assignment (community_set_id, community_id, note_id, confidence, source_type)
         VALUES ($1, $2, $3, NULL, $4)`,
        [communitySetId, communityId, noteId, input.sourceType],
      )
    }

    return {
      id: communitySetId,
      name: input.name,
      sourceType: input.sourceType,
      graphSourceId: sourceId,
      searchQuery: input.filters?.query,
      filters: input.filters,
      freshness,
    }
  }

  async rerunDynamicCommunity(sourceId: string): Promise<CommunityAssignmentView[]> {
    const result = await this.db.query<{ parameters_json: unknown; source_type: CommunitySourceType }>(
      `SELECT parameters_json, source_type FROM community_set WHERE id = $1`,
      [sourceId],
    )
    if (result.rows.length === 0) throw new Error(`Community source not found: ${sourceId}`)
    const parameters = parseObject<{ filters?: CommunityFilterDefinition | null }>(result.rows[0].parameters_json)
    if (!parameters?.filters) return this.getCommunityAssignments(sourceId)
    const preview = await this.previewDynamicCommunity(parameters.filters)
    return preview.map((assignment) => ({ ...assignment, communitySourceId: sourceId, sourceType: 'dynamic' }))
  }

  async listCommunitySources(): Promise<CommunitySourceDescriptor[]> {
    const result = await this.db.query<{
      id: string
      graph_source_id: string
      name: string
      source_type: CommunitySourceType
      parameters_json: unknown | null
      freshness_json: unknown | null
      created_at: Date
    }>(`SELECT * FROM community_set ORDER BY created_at, name`)
    return result.rows.map((row) => {
      const parameters = parseObject<{ filters?: CommunityFilterDefinition | null }>(row.parameters_json)
      const freshness = parseObject<{ status?: 'fresh' | 'stale' | 'unknown' }>(row.freshness_json)
      return {
        id: row.id,
        name: row.name,
        sourceType: row.source_type,
        graphSourceId: row.graph_source_id,
        searchQuery: parameters?.filters?.query,
        filters: parameters?.filters ?? undefined,
        createdAt: iso(row.created_at),
        freshness: freshness?.status ?? 'unknown',
      }
    })
  }

  async getCommunityAssignments(sourceId: string): Promise<CommunityAssignmentView[]> {
    const result = await this.db.query<{
      community_set_id: string
      community_id: string
      note_id: string
      label: string | null
      confidence: number | null
      source_type: CommunitySourceType
    }>(
      `SELECT ca.community_set_id, ca.community_id, ca.note_id, c.label, ca.confidence, ca.source_type
       FROM community_assignment ca
       LEFT JOIN community c ON c.community_set_id = ca.community_set_id AND c.id = ca.community_id
       WHERE ca.community_set_id = $1
       ORDER BY ca.community_id, ca.note_id`,
      [sourceId],
    )
    return result.rows.map((row) => ({
      communitySourceId: row.community_set_id,
      communityId: row.community_id,
      noteId: row.note_id,
      label: row.label,
      confidence: row.confidence,
      sourceType: row.source_type,
    }))
  }

  async listCommunitySummaries(sourceId: string): Promise<CommunitySummary[]> {
    const result = await this.db.query<{
      id: string
      label: string | null
      source_type: CommunitySourceType
      size: number | null
      confidence: number | null
      representative_note_ids: string[] | null
      freshness_json: unknown | null
    }>(
      `SELECT c.id, c.label, cs.source_type, c.size, c.confidence, c.representative_note_ids, cs.freshness_json
       FROM community c
       JOIN community_set cs ON cs.id = c.community_set_id
       WHERE c.community_set_id = $1
       ORDER BY c.rank NULLS LAST, c.id`,
      [sourceId],
    )
    return result.rows.map((row) => {
      const freshness = parseObject<{ status?: 'fresh' | 'stale' | 'unknown' }>(row.freshness_json)
      return {
        id: row.id,
        label: row.label ?? row.id,
        sourceType: row.source_type,
        size: row.size ?? 0,
        confidence: row.confidence,
        representativeNoteIds: row.representative_note_ids ?? [],
        freshness: freshness?.status ?? 'unknown',
      }
    })
  }

  private async resolveFilterNoteIds(filters: CommunityFilterDefinition): Promise<string[]> {
    if (filters.conceptIds?.length) {
      throw new Error('Community concept filters are not supported locally yet')
    }
    if (filters.noteIds?.length && !filters.query && !filters.tags?.length && !filters.collectionIds?.length && !filters.embeddingSetSelector) {
      return [...filters.noteIds].sort()
    }
    const result = await new SearchRepository(this.db, true).search(filters.query ?? '', {
      limit: 1000,
      tags: filters.tags,
      collection_id: filters.collectionIds?.[0],
      embeddingSetSelector: filters.embeddingSetSelector,
    })
    const ids = result.results.map((row) => row.id)
    return filters.noteIds?.length ? ids.filter((id) => filters.noteIds?.includes(id)) : ids
  }
}
