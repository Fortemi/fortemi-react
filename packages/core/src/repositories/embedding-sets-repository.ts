/**
 * EmbeddingSetsRepository - named, filter, and virtual embedding set API.
 */

import type { QueryExecutor } from '../storage-backend.js'
import { generateId } from '../uuid.js'
import { computeHash } from '../hash.js'

const ATTACHMENT_TEXT_JOIN = `
       LEFT JOIN (
         SELECT note_id,
                string_agg(extracted_text, ' ' ORDER BY position, created_at)
                  FILTER (WHERE extracted_text IS NOT NULL AND extracted_text <> '') as extracted_text
         FROM attachment
         WHERE deleted_at IS NULL
         GROUP BY note_id
       ) ax ON ax.note_id = n.id`
const COMBINED_TEXT_VECTOR_SQL = `to_tsvector('english', (coalesce(c.content, '') || ' ' || coalesce(ax.extracted_text, '')))`

export type EmbeddingSetKind = 'physical' | 'filter' | 'virtual'
export type EmbeddingSetMode = 'auto' | 'manual' | 'mixed'

export interface EmbeddingSetCriteria {
  query?: string
  tags?: string[]
  collectionIds?: string[]
  conceptIds?: string[]
  noteIds?: string[]
  sources?: string[]
  formats?: string[]
  visibilities?: string[]
  isStarred?: boolean
  isArchived?: boolean
  hasTitle?: boolean
  hasEmbedding?: boolean
  isUserEdited?: boolean
  hasAiMetadata?: boolean
  hasRevisions?: boolean
  minGenerationCount?: number
  maxGenerationCount?: number
  updatedAfter?: string
  updatedBefore?: string
}

export interface EmbeddingSetFreshness {
  status: 'fresh' | 'stale' | 'unknown'
  sourceHash?: string
  checkedAt?: string
  reason?: string
}

export interface EmbeddingCompatibilityPolicy {
  model: 'require-same' | 'allow-compatible-family'
  dimension: 'require-same' | 'allow-truncation'
  duplicateVectors: 'prefer-latest' | 'prefer-set-order' | 'error'
  missingVectors: 'omit' | 'include-unembedded-note' | 'error'
}

export interface VirtualMaterializationPolicy {
  allowed: boolean
  includeResolvedMembers?: boolean
  includeResolvedEdges?: boolean
  freshness: 'fresh' | 'stale' | 'unknown'
  inputHash?: string
  generatedAt?: string
  resolvedMemberCount?: number
}

export interface CriteriaVirtualSource {
  type: 'criteria'
  baseSetId: string
  criteria: EmbeddingSetCriteria
}

export interface SetOperationVirtualSource {
  type: 'set-operation'
  operation: 'union' | 'intersection' | 'difference'
  setIds: string[]
}

export interface FallbackVirtualSource {
  type: 'fallback'
  preferredSetIds: string[]
}

export interface LatestCompatibleVirtualSource {
  type: 'latest-compatible'
  candidateSetIds: string[]
  model?: string
  dimension?: number
}

export interface SnapshotVirtualSource {
  type: 'snapshot'
  snapshotId: string
  sourceDefinitionId: string
  generatedAt: string
  inputHash: string
}

export type VirtualEmbeddingSetSource =
  | CriteriaVirtualSource
  | SetOperationVirtualSource
  | FallbackVirtualSource
  | LatestCompatibleVirtualSource
  | SnapshotVirtualSource

export interface VirtualEmbeddingSetDefinition {
  id: string
  name: string
  purpose?: string | null
  source: VirtualEmbeddingSetSource
  compatibility: EmbeddingCompatibilityPolicy
  materialization?: VirtualMaterializationPolicy
  createdAt?: string
  updatedAt?: string
}

export interface EmbeddingSetSelector {
  kind: 'default' | 'embedding-set' | 'virtual-definition'
  embeddingSetId?: string
  definition?: VirtualEmbeddingSetDefinition
}

export interface EmbeddingSetDescriptor {
  id: string
  name: string
  purpose?: string | null
  kind: EmbeddingSetKind
  mode?: EmbeddingSetMode
  model?: string
  dimension?: number
  truncateDimension?: number | null
  criteria?: EmbeddingSetCriteria | null
  createdAt?: string
  updatedAt?: string
  freshness?: EmbeddingSetFreshness
}

export type VirtualEmbeddingSetValidationError =
  | { code: 'mixed-models'; setIds: string[] }
  | { code: 'mixed-dimensions'; setIds: string[] }
  | { code: 'missing-vector'; noteId: string; setId: string }
  | { code: 'duplicate-vector'; noteId: string; setIds: string[] }
  | { code: 'stale-snapshot'; snapshotId: string }
  | { code: 'unsupported-criteria'; field: string }

export interface ResolvedEmbeddingRow {
  note_id: string
  embedding_set_id: string
  embedding_id: string
  vector: string
  created_at: Date
}

export interface ResolvedEmbeddingSet {
  selector: EmbeddingSetSelector
  rows: ResolvedEmbeddingRow[]
  noteIds: string[]
  embeddingIds: string[]
  errors: VirtualEmbeddingSetValidationError[]
  freshness: EmbeddingSetFreshness
  resolutionSource: 'live' | 'materialized'
}

export interface EmbeddingSetRow {
  id: string
  name: string
  purpose: string | null
  model_name: string
  dimensions: number
  kind: EmbeddingSetKind
  mode: EmbeddingSetMode | null
  truncate_dimension: number | null
  criteria_json: unknown | null
  source_json: unknown | null
  compatibility_json: unknown | null
  materialization_json: unknown | null
  freshness_json: unknown | null
  created_at: Date
  updated_at: Date
}

export interface EmbeddingSetCreateInput {
  id?: string
  name: string
  purpose?: string | null
  model_name?: string
  dimensions?: number
  kind?: EmbeddingSetKind
  mode?: EmbeddingSetMode | null
  truncate_dimension?: number | null
  criteria?: EmbeddingSetCriteria | null
}

export interface EmbeddingSetEmbeddingInput {
  id?: string
  note_id: string
  embedding_set_id: string
  vector: number[]
}

const DEFAULT_COMPATIBILITY: EmbeddingCompatibilityPolicy = {
  model: 'require-same',
  dimension: 'require-same',
  duplicateVectors: 'prefer-set-order',
  missingVectors: 'omit',
}

function jsonParam(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value)
}

function asObject<T>(value: unknown): T | null {
  if (value == null) return null
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function dateString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : value
}

function dateMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function hashJson(value: unknown): string {
  return computeHash(new TextEncoder().encode(JSON.stringify(value)))
}

export class EmbeddingSetsRepository {
  constructor(private db: QueryExecutor) {}

  async create(input: EmbeddingSetCreateInput): Promise<EmbeddingSetRow> {
    const id = input.id ?? generateId()
    await this.db.query(
      `INSERT INTO embedding_set (
         id, name, purpose, model_name, dimensions, kind, mode,
         truncate_dimension, criteria_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        id,
        input.name,
        input.purpose ?? null,
        input.model_name ?? 'all-MiniLM-L6-v2',
        input.dimensions ?? 384,
        input.kind ?? 'physical',
        input.mode ?? null,
        input.truncate_dimension ?? null,
        jsonParam(input.criteria ?? null),
      ],
    )
    return this.get(id)
  }

  async createVirtualDefinition(input: VirtualEmbeddingSetDefinition): Promise<EmbeddingSetRow> {
    const id = input.id ?? generateId()
    await this.db.query(
      `INSERT INTO embedding_set (
         id, name, purpose, model_name, dimensions, kind, mode,
         source_json, compatibility_json, materialization_json, freshness_json, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'virtual', 'auto', $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
                 COALESCE($10::timestamptz, now()), COALESCE($11::timestamptz, now()))`,
      [
        id,
        input.name,
        input.purpose ?? null,
        this.inferDefinitionModel(input) ?? 'virtual',
        this.inferDefinitionDimension(input) ?? 0,
        jsonParam(input.source),
        jsonParam(input.compatibility),
        jsonParam(input.materialization ?? null),
        jsonParam({ status: input.materialization?.freshness ?? 'unknown' }),
        input.createdAt ?? null,
        input.updatedAt ?? null,
      ],
    )
    const row = await this.get(id)
    if (input.materialization?.allowed) {
      await this.refreshMaterializedVirtualSet(id)
      return this.get(id)
    }
    return row
  }

  async ensureDefault(): Promise<EmbeddingSetRow> {
    const existing = await this.db.query<EmbeddingSetRow>(
      `SELECT * FROM embedding_set WHERE name = $1 AND model_name = $2 AND kind = 'physical' ORDER BY created_at LIMIT 1`,
      ['Full content', 'all-MiniLM-L6-v2'],
    )
    if (existing.rows.length > 0) return existing.rows[0]

    return this.create({
      name: 'Full content',
      purpose: 'Semantic search over full revised note content',
      model_name: 'all-MiniLM-L6-v2',
      dimensions: 384,
      kind: 'physical',
    })
  }

  async get(id: string): Promise<EmbeddingSetRow> {
    const result = await this.db.query<EmbeddingSetRow>(
      `SELECT * FROM embedding_set WHERE id = $1`,
      [id],
    )
    if (result.rows.length === 0) throw new Error(`Embedding set not found: ${id}`)
    return result.rows[0]
  }

  async list(): Promise<EmbeddingSetRow[]> {
    const result = await this.db.query<EmbeddingSetRow>(
      `SELECT * FROM embedding_set ORDER BY created_at, name`,
    )
    return result.rows
  }

  async listDescriptors(): Promise<EmbeddingSetDescriptor[]> {
    const rows = await this.list()
    return rows.map((row) => this.toDescriptor(row))
  }

  toDescriptor(row: EmbeddingSetRow): EmbeddingSetDescriptor {
    return {
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      kind: row.kind,
      mode: row.mode ?? undefined,
      model: row.model_name,
      dimension: row.dimensions,
      truncateDimension: row.truncate_dimension,
      criteria: asObject<EmbeddingSetCriteria>(row.criteria_json),
      createdAt: dateString(row.created_at),
      updatedAt: dateString(row.updated_at),
      freshness: asObject<EmbeddingSetFreshness>(row.freshness_json) ?? { status: 'fresh' },
    }
  }

  async putEmbedding(input: EmbeddingSetEmbeddingInput): Promise<{ id: string }> {
    const set = await this.get(input.embedding_set_id)
    if (set.kind === 'virtual') {
      throw new Error(`Cannot store vectors directly in virtual embedding set: ${set.id}`)
    }
    if (input.vector.length !== set.dimensions) {
      throw new Error(
        `Embedding vector has ${input.vector.length} dimensions; set ${set.id} expects ${set.dimensions}`,
      )
    }

    await this.db.query(
      `DELETE FROM embedding_set_member WHERE note_id = $1 AND embedding_set_id = $2`,
      [input.note_id, input.embedding_set_id],
    )
    await this.db.query(
      `DELETE FROM embedding WHERE note_id = $1 AND embedding_set_id = $2`,
      [input.note_id, input.embedding_set_id],
    )

    const embeddingId = input.id ?? generateId()
    const vector = `[${input.vector.join(',')}]`
    await this.db.query(
      `INSERT INTO embedding (id, note_id, embedding_set_id, vector)
       VALUES ($1, $2, $3, $4::vector)`,
      [embeddingId, input.note_id, input.embedding_set_id, vector],
    )

    await this.db.query(
      `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id)
       VALUES ($1, $2, $3)`,
      [input.embedding_set_id, input.note_id, embeddingId],
    )

    return { id: embeddingId }
  }

  async resolveSelector(selector: EmbeddingSetSelector): Promise<ResolvedEmbeddingSet> {
    if (selector.kind === 'default') {
      const set = await this.ensureDefault()
      return this.resolvePhysicalSet({ kind: 'embedding-set', embeddingSetId: set.id }, set.id)
    }
    if (selector.kind === 'embedding-set') {
      if (!selector.embeddingSetId) throw new Error('embedding-set selector requires embeddingSetId')
      const set = await this.get(selector.embeddingSetId)
      if (set.kind === 'virtual') {
        const definition = this.definitionFromRow(set)
        return this.resolveDefinition({ kind: 'embedding-set', embeddingSetId: set.id }, definition, set)
      }
      return this.resolvePhysicalSet(selector, set.id)
    }
    if (!selector.definition) throw new Error('virtual-definition selector requires definition')
    return this.resolveDefinition(selector, selector.definition)
  }

  async refreshMaterializedVirtualSet(setId: string): Promise<ResolvedEmbeddingSet> {
    const set = await this.get(setId)
    if (set.kind !== 'virtual') throw new Error(`Embedding set is not virtual: ${setId}`)
    const definition = this.definitionFromRow(set)
    if (!definition.materialization?.allowed) {
      throw new Error(`Virtual embedding set does not allow materialization: ${setId}`)
    }

    const live = await this.resolveDefinition(
      { kind: 'embedding-set', embeddingSetId: setId },
      definition,
      set,
      { forceLive: true },
    )
    await this.db.query(`DELETE FROM embedding_set_member WHERE embedding_set_id = $1`, [setId])
    for (const row of live.rows) {
      await this.db.query(
        `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [setId, row.note_id, row.embedding_id],
      )
    }

    const inputHash = this.resolutionInputHash(definition, live.rows)
    const generatedAt = new Date().toISOString()
    const materialization: VirtualMaterializationPolicy = {
      ...definition.materialization,
      allowed: true,
      includeResolvedMembers: true,
      freshness: 'fresh',
      inputHash,
      generatedAt,
      resolvedMemberCount: live.rows.length,
    }
    const freshness: EmbeddingSetFreshness = {
      status: 'fresh',
      sourceHash: inputHash,
      checkedAt: generatedAt,
    }
    await this.db.query(
      `UPDATE embedding_set
       SET materialization_json = $2::jsonb, freshness_json = $3::jsonb, updated_at = now()
       WHERE id = $1`,
      [setId, jsonParam(materialization), jsonParam(freshness)],
    )

    return this.finalizeResolution(
      { kind: 'embedding-set', embeddingSetId: setId },
      live.rows,
      live.errors,
      definition.compatibility,
      'fresh',
      'materialized',
    )
  }

  async markVirtualSetStale(setId: string, reason: string): Promise<void> {
    const set = await this.get(setId)
    if (set.kind !== 'virtual') throw new Error(`Embedding set is not virtual: ${setId}`)
    const definition = this.definitionFromRow(set)
    const now = new Date().toISOString()
    const materialization = definition.materialization
      ? { ...definition.materialization, freshness: 'stale' as const }
      : null
    await this.db.query(
      `UPDATE embedding_set
       SET materialization_json = $2::jsonb, freshness_json = $3::jsonb, updated_at = now()
       WHERE id = $1`,
      [
        setId,
        jsonParam(materialization),
        jsonParam({ status: 'stale', sourceHash: definition.materialization?.inputHash, checkedAt: now, reason }),
      ],
    )
  }

  private async resolveDefinition(
    selector: EmbeddingSetSelector,
    definition: VirtualEmbeddingSetDefinition,
    set?: EmbeddingSetRow,
    options: { forceLive?: boolean } = {},
  ): Promise<ResolvedEmbeddingSet> {
    if (!options.forceLive && set && definition.materialization?.allowed && definition.materialization.freshness === 'fresh') {
      const materialized = await this.resolveMaterializedRows(set.id)
      if (materialized.length > 0 || definition.materialization.resolvedMemberCount === 0) {
        return this.finalizeResolution(
          selector,
          materialized,
          [],
          definition.compatibility,
          'fresh',
          'materialized',
        )
      }
    }

    let rows: ResolvedEmbeddingRow[]
    const errors: VirtualEmbeddingSetValidationError[] = []
    switch (definition.source.type) {
      case 'criteria':
        rows = await this.resolveCriteriaSource(definition.source)
        break
      case 'set-operation':
        rows = await this.resolveSetOperationSource(definition.source, definition.compatibility, errors)
        break
      case 'fallback':
        rows = await this.resolveFallbackSource(definition.source.preferredSetIds, definition.compatibility, errors)
        break
      case 'latest-compatible':
        rows = await this.resolveLatestCompatibleSource(definition.source, definition.compatibility, errors)
        break
      case 'snapshot':
        rows = await this.resolvePhysicalRows(definition.source.snapshotId)
        break
      default:
        rows = []
    }
    return this.finalizeResolution(selector, rows, errors, definition.compatibility, definition.materialization?.freshness ?? 'unknown', 'live')
  }

  private async resolvePhysicalSet(selector: EmbeddingSetSelector, setId: string): Promise<ResolvedEmbeddingSet> {
    return this.finalizeResolution(selector, await this.resolvePhysicalRows(setId), [], DEFAULT_COMPATIBILITY, 'fresh', 'live')
  }

  private async resolvePhysicalRows(setId: string): Promise<ResolvedEmbeddingRow[]> {
    const result = await this.db.query<ResolvedEmbeddingRow>(
      `SELECT note_id, embedding_set_id, id as embedding_id, vector::text as vector, created_at
       FROM embedding
       WHERE embedding_set_id = $1
       ORDER BY note_id, created_at DESC`,
      [setId],
    )
    return result.rows
  }

  private async resolveMaterializedRows(setId: string): Promise<ResolvedEmbeddingRow[]> {
    const result = await this.db.query<ResolvedEmbeddingRow>(
      `SELECT e.note_id, e.embedding_set_id, e.id as embedding_id, e.vector::text as vector, e.created_at
       FROM embedding_set_member m
       JOIN embedding e ON e.id = m.embedding_id
       WHERE m.embedding_set_id = $1
       ORDER BY e.note_id, e.created_at DESC`,
      [setId],
    )
    return result.rows
  }

  private async resolveCriteriaSource(source: CriteriaVirtualSource): Promise<ResolvedEmbeddingRow[]> {
    const criteria = source.criteria
    if (criteria.conceptIds && criteria.conceptIds.length > 0) {
      throw new Error('Unsupported virtual embedding-set criteria field: conceptIds')
    }
    const conditions = ['e.embedding_set_id = $1', 'n.deleted_at IS NULL']
    const params: unknown[] = [source.baseSetId]
    let idx = 2
    if (criteria.noteIds?.length) {
      conditions.push(`n.id = ANY($${idx++})`)
      params.push(criteria.noteIds)
    }
    if (criteria.tags?.length) {
      conditions.push(`EXISTS (SELECT 1 FROM note_tag nt WHERE nt.note_id = n.id AND nt.tag = ANY($${idx++}))`)
      params.push(criteria.tags)
    }
    if (criteria.collectionIds?.length) {
      conditions.push(`EXISTS (SELECT 1 FROM collection_note cn WHERE cn.note_id = n.id AND cn.collection_id = ANY($${idx++}))`)
      params.push(criteria.collectionIds)
    }
    if (criteria.sources?.length) {
      conditions.push(`n.source = ANY($${idx++})`)
      params.push(criteria.sources)
    }
    if (criteria.formats?.length) {
      conditions.push(`n.format = ANY($${idx++})`)
      params.push(criteria.formats)
    }
    if (criteria.visibilities?.length) {
      conditions.push(`n.visibility = ANY($${idx++})`)
      params.push(criteria.visibilities)
    }
    if (criteria.isStarred !== undefined) {
      conditions.push(`n.is_starred = $${idx++}`)
      params.push(criteria.isStarred)
    }
    if (criteria.isArchived !== undefined) {
      conditions.push(`n.is_archived = $${idx++}`)
      params.push(criteria.isArchived)
    }
    if (criteria.hasTitle !== undefined) {
      conditions.push(criteria.hasTitle ? `n.title IS NOT NULL AND n.title <> ''` : `(n.title IS NULL OR n.title = '')`)
    }
    if (criteria.hasEmbedding === false) {
      conditions.push('FALSE')
    }
    if (criteria.isUserEdited !== undefined) {
      conditions.push(`COALESCE(c.is_user_edited, false) = $${idx++}`)
      params.push(criteria.isUserEdited)
    }
    if (criteria.hasAiMetadata !== undefined) {
      conditions.push(criteria.hasAiMetadata ? `c.ai_metadata IS NOT NULL` : `c.ai_metadata IS NULL`)
    }
    if (criteria.hasRevisions !== undefined) {
      conditions.push(criteria.hasRevisions
        ? `EXISTS (SELECT 1 FROM note_revision nr WHERE nr.note_id = n.id)`
        : `NOT EXISTS (SELECT 1 FROM note_revision nr WHERE nr.note_id = n.id)`)
    }
    if (criteria.minGenerationCount !== undefined) {
      conditions.push(`COALESCE(c.generation_count, 0) >= $${idx++}`)
      params.push(criteria.minGenerationCount)
    }
    if (criteria.maxGenerationCount !== undefined) {
      conditions.push(`COALESCE(c.generation_count, 0) <= $${idx++}`)
      params.push(criteria.maxGenerationCount)
    }
    if (criteria.updatedAfter) {
      conditions.push(`n.updated_at >= $${idx++}`)
      params.push(criteria.updatedAfter)
    }
    if (criteria.updatedBefore) {
      conditions.push(`n.updated_at <= $${idx++}`)
      params.push(criteria.updatedBefore)
    }
    if (criteria.query?.trim()) {
      conditions.push(`(n.tsv @@ plainto_tsquery('english', $${idx}) OR ${COMBINED_TEXT_VECTOR_SQL} @@ plainto_tsquery('english', $${idx}))`)
      params.push(criteria.query)
    }

    const result = await this.db.query<ResolvedEmbeddingRow>(
      `SELECT e.note_id, e.embedding_set_id, e.id as embedding_id, e.vector::text as vector, e.created_at
       FROM embedding e
       JOIN note n ON n.id = e.note_id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       ${ATTACHMENT_TEXT_JOIN}
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.note_id, e.created_at DESC`,
      params,
    )
    return result.rows
  }

  private async resolveSetOperationSource(
    source: SetOperationVirtualSource,
    compatibility: EmbeddingCompatibilityPolicy,
    errors: VirtualEmbeddingSetValidationError[],
  ): Promise<ResolvedEmbeddingRow[]> {
    const bySet = new Map<string, ResolvedEmbeddingRow[]>()
    for (const setId of source.setIds) bySet.set(setId, await this.resolvePhysicalRows(setId))
    await this.validateCompatibility(source.setIds, compatibility, errors)

    const noteSets = source.setIds.map((setId) => new Set((bySet.get(setId) ?? []).map((row) => row.note_id)))
    const firstRows = bySet.get(source.setIds[0]) ?? []
    if (source.operation === 'difference') {
      const excluded = new Set(noteSets.slice(1).flatMap((set) => Array.from(set)))
      return firstRows.filter((row) => !excluded.has(row.note_id))
    }
    if (source.operation === 'intersection') {
      return firstRows.filter((row) => noteSets.every((set) => set.has(row.note_id)))
    }
    return this.resolveDuplicateRows(source.setIds.flatMap((setId) => bySet.get(setId) ?? []), compatibility, errors)
  }

  private async resolveFallbackSource(
    setIds: string[],
    compatibility: EmbeddingCompatibilityPolicy,
    errors: VirtualEmbeddingSetValidationError[],
  ): Promise<ResolvedEmbeddingRow[]> {
    await this.validateCompatibility(setIds, compatibility, errors)
    const selected = new Map<string, ResolvedEmbeddingRow>()
    for (const setId of setIds) {
      for (const row of await this.resolvePhysicalRows(setId)) {
        if (!selected.has(row.note_id)) selected.set(row.note_id, row)
      }
    }
    return Array.from(selected.values()).sort((a, b) => a.note_id.localeCompare(b.note_id))
  }

  private async resolveLatestCompatibleSource(
    source: LatestCompatibleVirtualSource,
    compatibility: EmbeddingCompatibilityPolicy,
    errors: VirtualEmbeddingSetValidationError[],
  ): Promise<ResolvedEmbeddingRow[]> {
    const sets = []
    for (const setId of source.candidateSetIds) {
      const set = await this.get(setId)
      if (source.model && set.model_name !== source.model) continue
      if (source.dimension && set.dimensions !== source.dimension) continue
      sets.push(set)
    }
    sets.sort((a, b) => dateMillis(b.updated_at) - dateMillis(a.updated_at) || dateMillis(b.created_at) - dateMillis(a.created_at))
    return this.resolveFallbackSource(sets.map((set) => set.id), compatibility, errors)
  }

  private async validateCompatibility(
    setIds: string[],
    compatibility: EmbeddingCompatibilityPolicy,
    errors: VirtualEmbeddingSetValidationError[],
  ): Promise<void> {
    const sets = []
    for (const setId of setIds) sets.push(await this.get(setId))
    if (compatibility.model === 'require-same' && new Set(sets.map((set) => set.model_name)).size > 1) {
      errors.push({ code: 'mixed-models', setIds })
    }
    if (compatibility.dimension === 'require-same' && new Set(sets.map((set) => set.dimensions)).size > 1) {
      errors.push({ code: 'mixed-dimensions', setIds })
    }
  }

  private resolveDuplicateRows(
    rows: ResolvedEmbeddingRow[],
    compatibility: EmbeddingCompatibilityPolicy,
    errors: VirtualEmbeddingSetValidationError[],
  ): ResolvedEmbeddingRow[] {
    const byNote = new Map<string, ResolvedEmbeddingRow[]>()
    for (const row of rows) {
      const existing = byNote.get(row.note_id) ?? []
      existing.push(row)
      byNote.set(row.note_id, existing)
    }
    const resolved: ResolvedEmbeddingRow[] = []
    for (const [noteId, noteRows] of byNote) {
      if (noteRows.length > 1 && compatibility.duplicateVectors === 'error') {
        errors.push({ code: 'duplicate-vector', noteId, setIds: noteRows.map((row) => row.embedding_set_id) })
        continue
      }
      const ordered = [...noteRows]
      if (compatibility.duplicateVectors === 'prefer-latest') {
        ordered.sort((a, b) => dateMillis(b.created_at) - dateMillis(a.created_at))
      }
      resolved.push(ordered[0])
    }
    return resolved.sort((a, b) => a.note_id.localeCompare(b.note_id))
  }

  private finalizeResolution(
    selector: EmbeddingSetSelector,
    rows: ResolvedEmbeddingRow[],
    errors: VirtualEmbeddingSetValidationError[],
    compatibility: EmbeddingCompatibilityPolicy,
    freshness: EmbeddingSetFreshness['status'],
    resolutionSource: ResolvedEmbeddingSet['resolutionSource'],
  ): ResolvedEmbeddingSet {
    const deduped = this.resolveDuplicateRows(rows, compatibility, errors)
    return {
      selector,
      rows: deduped,
      noteIds: deduped.map((row) => row.note_id),
      embeddingIds: deduped.map((row) => row.embedding_id),
      errors,
      freshness: { status: freshness },
      resolutionSource,
    }
  }

  private resolutionInputHash(
    definition: VirtualEmbeddingSetDefinition,
    rows: ResolvedEmbeddingRow[],
  ): string {
    return hashJson({
      source: definition.source,
      compatibility: definition.compatibility,
      members: rows.map((row) => [row.note_id, row.embedding_set_id, row.embedding_id]),
    })
  }

  private definitionFromRow(row: EmbeddingSetRow): VirtualEmbeddingSetDefinition {
    const source = asObject<VirtualEmbeddingSetSource>(row.source_json)
    if (!source) throw new Error(`Virtual embedding set has no source definition: ${row.id}`)
    return {
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      source,
      compatibility: asObject<EmbeddingCompatibilityPolicy>(row.compatibility_json) ?? DEFAULT_COMPATIBILITY,
      materialization: asObject<VirtualMaterializationPolicy>(row.materialization_json) ?? undefined,
      createdAt: dateString(row.created_at),
      updatedAt: dateString(row.updated_at),
    }
  }

  private inferDefinitionModel(input: VirtualEmbeddingSetDefinition): string | null {
    if (input.source.type === 'latest-compatible') return input.source.model ?? null
    return null
  }

  private inferDefinitionDimension(input: VirtualEmbeddingSetDefinition): number | null {
    if (input.source.type === 'latest-compatible') return input.source.dimension ?? null
    return null
  }
}
