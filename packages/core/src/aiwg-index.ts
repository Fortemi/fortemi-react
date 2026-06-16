export type AiwgFortemiRecordType =
  | 'crm.contact'
  | 'crm.organization'
  | 'crm.event'
  | 'crm.interaction'
  | 'aiwg.artifact'
  | 'docs.page'

export type AiwgPrivacyClassification = 'private' | 'sanitized' | 'public'
export type AiwgProvenanceConfidence = 'source' | 'candidate' | 'reviewed' | 'rejected'
export type AiwgReviewAction = 'accept' | 'reject' | 'defer'

export interface AiwgFortemiRecordSource {
  path: string
  repo_relative_path: string
  locator: string
}

export interface AiwgFortemiRelationship {
  type: string
  target_id: string
  source_path?: string
}

export interface AiwgFortemiProvenance {
  field: string
  source: string
  path: string
  confidence: AiwgProvenanceConfidence
  privacy: AiwgPrivacyClassification
}

export interface AiwgFortemiRecord {
  schema_version: 'aiwg.fortemi.index.record.v1'
  id: string
  type: AiwgFortemiRecordType
  source: AiwgFortemiRecordSource
  title: string
  text: string
  facets: Record<string, string[]>
  tags: string[]
  concepts: string[]
  relationships: AiwgFortemiRelationship[]
  provenance: AiwgFortemiProvenance[]
  privacy: {
    classification: AiwgPrivacyClassification
    pii: boolean
  }
  updated_at: string
}

export interface AiwgFortemiIndexExport {
  schema_version: 'aiwg.fortemi.index.export.v1'
  generated_at: string
  source: {
    repo: string
    privacy: AiwgPrivacyClassification
  }
  items: AiwgFortemiRecord[]
}

export interface AiwgFortemiChunkPartRef {
  href: string
  offset: number
  count: number
}

// Fields a scan part must retain for query/browse/rank/facet to work. The rest
// (source, provenance, relationships, updated_at) are detail-only and may be
// dropped from scan parts via `projection`, then resolved on demand by id.
export const AIWG_SCAN_REQUIRED_FIELDS: Array<keyof AiwgFortemiRecord> = [
  'schema_version',
  'id',
  'type',
  'title',
  'text',
  'facets',
  'tags',
  'concepts',
  'privacy',
]

// A record as it appears in a scan part. With no manifest `projection`, this is a
// full AiwgFortemiRecord. With a projection, detail-only fields are absent — read
// them via the controller's getRecord(). Typed as the full record for ergonomics;
// query/browse code guards the projectable fields.
export type AiwgFortemiProjectedRecord =
  Pick<AiwgFortemiRecord, 'schema_version' | 'id' | 'type' | 'title' | 'text' | 'facets' | 'tags' | 'concepts' | 'privacy'>
  & Partial<AiwgFortemiRecord>

// How a record id is encoded into a detail filename/path segment.
//  - 'base64url': path-safe, single segment, no '%' — works on every static host,
//    including ids containing '/' (default for new builds; see #177).
//  - 'uri': encodeURIComponent — legacy. Breaks for ids containing '/' on static
//    servers that reject %2F (path-traversal protection → 404).
export type AiwgDetailIdEncoding = 'uri' | 'base64url'

// How the controller resolves a full record by id when scan parts are projected.
export interface AiwgFortemiChunkDetailRef {
  // href template containing `{id}`, relative to the manifest base — e.g.
  // "detail/{id}.json". The `{id}` is encoded per `encoding` at substitution.
  href: string
  // id→segment encoding. Absent is treated as 'uri' for backward compatibility
  // with manifests built before #177; new builds default to 'base64url'.
  encoding?: AiwgDetailIdEncoding
}

export interface AiwgFortemiChunkManifest {
  schema_version: 'aiwg.fortemi.index.chunk-manifest.v1'
  generated_at: string
  source: AiwgFortemiIndexExport['source']
  total: number
  part_size: number
  facets?: Record<string, Record<string, number>>
  // Field names present in scan-part items. Absent → scan parts carry whole records.
  // When set, must include AIWG_SCAN_REQUIRED_FIELDS.
  projection?: Array<keyof AiwgFortemiRecord>
  // Resolver for full records by id (used with `projection` to lazy-load detail).
  detail?: AiwgFortemiChunkDetailRef
  parts: AiwgFortemiChunkPartRef[]
}

export interface AiwgFortemiChunkPart {
  schema_version: 'aiwg.fortemi.index.chunk.v1'
  manifest_schema_version: 'aiwg.fortemi.index.chunk-manifest.v1'
  offset: number
  items: AiwgFortemiRecord[]
}

export interface AiwgIndexValidationResult {
  valid: boolean
  errors: string[]
  counts: Partial<Record<AiwgFortemiRecordType, number>>
}

export interface AiwgChunkedIndexValidationResult {
  valid: boolean
  errors: string[]
}

export interface AiwgIndexQueryOptions {
  types?: AiwgFortemiRecordType[]
  facets?: Record<string, string[]>
  tags?: string[]
  concepts?: string[]
  privacy?: AiwgPrivacyClassification[]
  relationshipTargetId?: string
  limit?: number
  offset?: number
  rank?: boolean
  snippets?: boolean
  snippetLength?: number
  weights?: Partial<AiwgIndexQueryWeights>
  includeMatches?: boolean
}

export interface AiwgIndexQueryWeights {
  title: number
  text: number
  tag: number
  concept: number
}

export interface AiwgIndexQueryMatch {
  field: 'title' | 'text' | 'tag' | 'concept'
  value: string
}

export interface AiwgIndexQueryRankedItem {
  item: AiwgFortemiRecord
  rank: number
  snippet?: string
  matches?: AiwgIndexQueryMatch[]
}

export interface AiwgIndexQueryResult {
  items: AiwgFortemiRecord[]
  total: number
  facets: Record<string, Record<string, number>>
  rankedItems?: AiwgIndexQueryRankedItem[]
}

export type AiwgChunkedIndexLoader = (
  part: AiwgFortemiChunkPartRef,
  manifest: AiwgFortemiChunkManifest,
) => Promise<unknown>

// Resolves a full record by id (used with projected scan parts). Returns the
// parsed record JSON; validated by the controller before use.
export type AiwgChunkedIndexDetailLoader = (
  id: string,
  manifest: AiwgFortemiChunkManifest,
) => Promise<unknown>

export interface AiwgChunkedIndexLoadOptions {
  maxCachedParts?: number
  // Required to resolve detail for projected indexes via getRecord(); ignored otherwise.
  detailLoader?: AiwgChunkedIndexDetailLoader
  maxCachedDetails?: number
  // Bounds the filtered/ranked match-set cache used to page a query without
  // re-scanning every part. Counts total cached entries across all queries
  // (LRU-evicted). Defaults to 5000. The cache is keyed on query + filters +
  // weights, so paging the same query (varying only offset/limit/sort/snippets)
  // reuses the scan; see queryChunked.
  maxCachedMatches?: number
}

export type AiwgChunkedIndexProgressPhase = 'part' | 'query'

export interface AiwgChunkedIndexProgress {
  phase: AiwgChunkedIndexProgressPhase
  done: number
  total: number
  href?: string
}

export interface AiwgChunkedIndexQueryOptions extends AiwgIndexQueryOptions {
  onProgress?: (progress: AiwgChunkedIndexProgress) => void
}

export interface AiwgChunkedIndexQueryResult extends AiwgIndexQueryResult {
  manifestTotal: number
  scannedParts: number
  fetchedParts: number
  complete: boolean
}

export interface AiwgReviewDecision {
  item_id: string
  action: AiwgReviewAction
  reason?: string
  updated_at: string
}

export interface AiwgReviewDecisionExport {
  schema_version: 'aiwg.fortemi.review-decisions.v1'
  generated_at: string
  source_export_schema_version: string
  decisions: AiwgReviewDecision[]
}

export interface AiwgIndexGraphOptions {
  communityFacet?: string
  communityTagPrefix?: string
  relationshipWeights?: Record<string, number>
  includeDanglingRelationships?: boolean
}

export interface AiwgReviewInput {
  item_id: string
  action: AiwgReviewAction
  reason?: string
}

export interface AiwgIndexControllerSnapshot {
  index: AiwgFortemiIndexExport | null
  chunked: {
    manifest: AiwgFortemiChunkManifest
    cachedParts: number
    maxCachedParts: number
  } | null
  data: AiwgIndexQueryResult | null
  error: Error | null
  reviewDecisions: AiwgReviewDecision[]
}

export type AiwgIndexControllerListener = (snapshot: AiwgIndexControllerSnapshot) => void

export interface AiwgIndexController {
  loadIndex(value: unknown): AiwgFortemiIndexExport
  loadChunkedIndex(
    manifest: unknown,
    loader: AiwgChunkedIndexLoader,
    options?: AiwgChunkedIndexLoadOptions,
  ): AiwgFortemiChunkManifest
  getIndex(): AiwgFortemiIndexExport | null
  getChunkedManifest(): AiwgFortemiChunkManifest | null
  getSnapshot(): AiwgIndexControllerSnapshot
  query(query?: string, options?: AiwgIndexQueryOptions): AiwgIndexQueryResult
  queryChunked(query?: string, options?: AiwgChunkedIndexQueryOptions): Promise<AiwgChunkedIndexQueryResult>
  // Resolve a full record by id. For a projected chunked index, fetches detail via
  // the detailLoader (bounded cache); for a whole-record index/parts, returns the
  // record from loaded data. Rejects if detail is unavailable.
  getRecord(id: string): Promise<AiwgFortemiRecord>
  clearChunkCache(): void
  toCommunityGraph(options?: AiwgIndexGraphOptions): ReturnType<typeof aiwgFortemiIndexToCommunityGraph>
  setReviewDecision(input: AiwgReviewInput): AiwgReviewDecision
  clearReviewDecision(itemId: string): void
  createReviewDecisionExport(generatedAt?: string): AiwgReviewDecisionExport
  subscribe(listener: AiwgIndexControllerListener): () => void
}

const REQUIRED_RECORD_FIELDS: Array<keyof AiwgFortemiRecord> = [
  'schema_version',
  'id',
  'type',
  'source',
  'title',
  'text',
  'facets',
  'tags',
  'concepts',
  'relationships',
  'provenance',
  'privacy',
  'updated_at',
]

const VALID_TYPES = new Set<AiwgFortemiRecordType>([
  'crm.contact',
  'crm.organization',
  'crm.event',
  'crm.interaction',
  'aiwg.artifact',
  'docs.page',
])

const DEFAULT_QUERY_WEIGHTS: AiwgIndexQueryWeights = {
  title: 4,
  tag: 3,
  concept: 2,
  text: 1,
}

function hasString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function pushFacet(counts: Record<string, Record<string, number>>, name: string, value: string) {
  counts[name] ??= {}
  counts[name][value] = (counts[name][value] ?? 0) + 1
}

function hasNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0
}

function hasPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0
}

function isFacetCounts(value: unknown): value is Record<string, Record<string, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((counts) => (
    !!counts
    && typeof counts === 'object'
    && !Array.isArray(counts)
    && Object.values(counts).every((count) => hasNonNegativeInteger(count))
  ))
}

export function validateAiwgFortemiIndexExport(value: unknown): AiwgIndexValidationResult {
  const errors: string[] = []
  const counts: Partial<Record<AiwgFortemiRecordType, number>> = {}
  const data = value as Partial<AiwgFortemiIndexExport>

  if (data?.schema_version !== 'aiwg.fortemi.index.export.v1') {
    errors.push('schema_version must be aiwg.fortemi.index.export.v1')
  }
  if (!hasString(data?.generated_at)) errors.push('generated_at is required')
  if (!hasString(data?.source?.repo)) errors.push('source.repo is required')
  if (!hasString(data?.source?.privacy)) errors.push('source.privacy is required')
  if (!Array.isArray(data?.items)) errors.push('items must be an array')

  const ids = new Set<string>()
  let previousId = ''
  for (const [index, item] of (data.items ?? []).entries()) {
    for (const field of REQUIRED_RECORD_FIELDS) {
      if (!(field in item)) errors.push('items[' + index + '].' + field + ' is required')
    }
    if (item.schema_version !== 'aiwg.fortemi.index.record.v1') {
      errors.push('items[' + index + '].schema_version must be aiwg.fortemi.index.record.v1')
    }
    if (!hasString(item.id)) errors.push('items[' + index + '].id is required')
    if (hasString(item.id) && ids.has(item.id)) errors.push('duplicate id: ' + item.id)
    if (hasString(item.id)) ids.add(item.id)
    if (previousId && hasString(item.id) && previousId.localeCompare(item.id) > 0) {
      errors.push('items must be sorted by id: ' + previousId + ' before ' + item.id)
    }
    if (hasString(item.id)) previousId = item.id
    if (!VALID_TYPES.has(item.type)) errors.push('items[' + index + '].type is invalid')
    else counts[item.type] = (counts[item.type] ?? 0) + 1
    if (!hasString(item.source?.path)) errors.push('items[' + index + '].source.path is required')
    if (!hasString(item.source?.repo_relative_path)) errors.push('items[' + index + '].source.repo_relative_path is required')
    if (!hasString(item.source?.locator)) errors.push('items[' + index + '].source.locator is required')
    if (!Array.isArray(item.tags)) errors.push('items[' + index + '].tags must be an array')
    if (!Array.isArray(item.concepts)) errors.push('items[' + index + '].concepts must be an array')
    if (!Array.isArray(item.relationships)) errors.push('items[' + index + '].relationships must be an array')
    if (!Array.isArray(item.provenance) || item.provenance.length === 0) {
      errors.push('items[' + index + '].provenance must be a non-empty array')
    }
    if (!item.privacy || typeof item.privacy.pii !== 'boolean' || !hasString(item.privacy.classification)) {
      errors.push('items[' + index + '].privacy requires classification and pii')
    }
  }

  return { valid: errors.length === 0, errors, counts }
}

export function assertAiwgFortemiIndexExport(value: unknown): AiwgFortemiIndexExport {
  const result = validateAiwgFortemiIndexExport(value)
  if (!result.valid) {
    throw new Error('Invalid AIWG Fortemi index export:\n' + result.errors.join('\n'))
  }
  return value as AiwgFortemiIndexExport
}

export function validateAiwgFortemiChunkManifest(value: unknown): AiwgChunkedIndexValidationResult {
  const errors: string[] = []
  const data = value as Partial<AiwgFortemiChunkManifest>

  if (data?.schema_version !== 'aiwg.fortemi.index.chunk-manifest.v1') {
    errors.push('schema_version must be aiwg.fortemi.index.chunk-manifest.v1')
  }
  if (!hasString(data?.generated_at)) errors.push('generated_at is required')
  if (!hasString(data?.source?.repo)) errors.push('source.repo is required')
  if (!hasString(data?.source?.privacy)) errors.push('source.privacy is required')
  if (!hasNonNegativeInteger(data?.total)) errors.push('total must be a non-negative integer')
  if (!hasPositiveInteger(data?.part_size)) errors.push('part_size must be a positive integer')
  if (data.facets !== undefined && !isFacetCounts(data.facets)) {
    errors.push('facets must be a nested string-to-number count object')
  }
  if (data.projection !== undefined) {
    if (!Array.isArray(data.projection) || !data.projection.every((field) => typeof field === 'string')) {
      errors.push('projection must be an array of field names')
    } else {
      const present = new Set(data.projection)
      for (const field of AIWG_SCAN_REQUIRED_FIELDS) {
        if (!present.has(field)) errors.push('projection must include scan-required field ' + field)
      }
    }
  }
  if (data.detail !== undefined) {
    if (!hasString(data.detail.href)) errors.push('detail.href is required')
    else if (!data.detail.href.includes('{id}')) errors.push('detail.href must contain the {id} placeholder')
    if (
      data.detail.encoding !== undefined &&
      data.detail.encoding !== 'uri' &&
      data.detail.encoding !== 'base64url'
    ) {
      errors.push("detail.encoding must be 'uri' or 'base64url'")
    }
  }
  if (!Array.isArray(data?.parts)) errors.push('parts must be an array')

  let expectedOffset = 0
  const parts = Array.isArray(data?.parts) ? data.parts : []
  for (const [index, part] of parts.entries()) {
    if (!hasString(part.href)) errors.push('parts[' + index + '].href is required')
    if (!hasNonNegativeInteger(part.offset)) errors.push('parts[' + index + '].offset must be a non-negative integer')
    if (!hasNonNegativeInteger(part.count)) errors.push('parts[' + index + '].count must be a non-negative integer')
    if (hasNonNegativeInteger(part.offset) && part.offset !== expectedOffset) {
      errors.push('parts[' + index + '].offset must be ' + expectedOffset)
    }
    if (hasNonNegativeInteger(part.count)) expectedOffset += part.count
  }
  if (hasNonNegativeInteger(data?.total) && expectedOffset !== data.total) {
    errors.push('parts counts must add up to total')
  }

  return { valid: errors.length === 0, errors }
}

export function assertAiwgFortemiChunkManifest(value: unknown): AiwgFortemiChunkManifest {
  const result = validateAiwgFortemiChunkManifest(value)
  if (!result.valid) {
    throw new Error('Invalid AIWG Fortemi chunk manifest:\n' + result.errors.join('\n'))
  }
  return value as AiwgFortemiChunkManifest
}

// Validate projected (slim) scan-part items: scan-required fields only, ids unique + sorted.
function validateProjectedRecords(items: Array<Partial<AiwgFortemiRecord>>): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  let previousId = ''
  for (const [index, item] of items.entries()) {
    if (item.schema_version !== 'aiwg.fortemi.index.record.v1') {
      errors.push('items[' + index + '].schema_version must be aiwg.fortemi.index.record.v1')
    }
    if (!hasString(item.id)) errors.push('items[' + index + '].id is required')
    if (hasString(item.id) && ids.has(item.id)) errors.push('duplicate id: ' + item.id)
    if (hasString(item.id)) ids.add(item.id)
    if (previousId && hasString(item.id) && previousId.localeCompare(item.id) > 0) {
      errors.push('items must be sorted by id: ' + previousId + ' before ' + item.id)
    }
    if (hasString(item.id)) previousId = item.id
    if (!item.type || !VALID_TYPES.has(item.type)) errors.push('items[' + index + '].type is invalid')
    if (!hasString(item.title)) errors.push('items[' + index + '].title is required')
    if (typeof item.text !== 'string') errors.push('items[' + index + '].text is required')
    if (!item.facets || typeof item.facets !== 'object' || Array.isArray(item.facets)) {
      errors.push('items[' + index + '].facets must be an object')
    }
    if (!Array.isArray(item.tags)) errors.push('items[' + index + '].tags must be an array')
    if (!Array.isArray(item.concepts)) errors.push('items[' + index + '].concepts must be an array')
    if (!item.privacy || !hasString(item.privacy.classification)) {
      errors.push('items[' + index + '].privacy.classification is required')
    }
  }
  return errors
}

export function validateAiwgFortemiChunkPart(
  value: unknown,
  partRef?: AiwgFortemiChunkPartRef,
  manifest?: AiwgFortemiChunkManifest,
): AiwgChunkedIndexValidationResult {
  const errors: string[] = []
  const data = value as Partial<AiwgFortemiChunkPart>

  if (data?.schema_version !== 'aiwg.fortemi.index.chunk.v1') {
    errors.push('schema_version must be aiwg.fortemi.index.chunk.v1')
  }
  if (data?.manifest_schema_version !== 'aiwg.fortemi.index.chunk-manifest.v1') {
    errors.push('manifest_schema_version must be aiwg.fortemi.index.chunk-manifest.v1')
  }
  if (!hasNonNegativeInteger(data?.offset)) errors.push('offset must be a non-negative integer')
  if (!Array.isArray(data?.items)) errors.push('items must be an array')

  if (partRef && hasNonNegativeInteger(data?.offset) && data.offset !== partRef.offset) {
    errors.push('offset must match manifest part offset ' + partRef.offset)
  }
  if (partRef && Array.isArray(data?.items) && data.items.length !== partRef.count) {
    errors.push('items length must match manifest part count ' + partRef.count)
  }

  if (Array.isArray(data?.items)) {
    if (manifest?.projection) {
      errors.push(...validateProjectedRecords(data.items).map((error) => 'items.' + error))
    } else {
      const validation = validateAiwgFortemiIndexExport({
        schema_version: 'aiwg.fortemi.index.export.v1',
        generated_at: manifest?.generated_at ?? '1970-01-01T00:00:00.000Z',
        source: manifest?.source ?? { repo: 'chunk', privacy: 'public' },
        items: data.items,
      })
      errors.push(...validation.errors.map((error) => 'items.' + error))
    }
  }

  return { valid: errors.length === 0, errors }
}

export function assertAiwgFortemiChunkPart(
  value: unknown,
  partRef?: AiwgFortemiChunkPartRef,
  manifest?: AiwgFortemiChunkManifest,
): AiwgFortemiChunkPart {
  const result = validateAiwgFortemiChunkPart(value, partRef, manifest)
  if (!result.valid) {
    throw new Error('Invalid AIWG Fortemi chunk part:\n' + result.errors.join('\n'))
  }
  return value as AiwgFortemiChunkPart
}

export function createAiwgFetchChunkLoader(baseUrl?: string | URL): AiwgChunkedIndexLoader {
  return async (part) => {
    const href = baseUrl ? new URL(part.href, baseUrl).toString() : part.href
    const response = await fetch(href)
    if (!response.ok) throw new Error('Failed to fetch AIWG index chunk ' + href + ': ' + response.status)
    return response.json()
  }
}

// Encode a record id into a single, path-safe detail filename segment.
//  - 'base64url' (default): UTF-8 → base64url (no '+', '/', '=', '%'). Safe for ids
//    containing '/' on static hosts that reject %2F (#177).
//  - 'uri': encodeURIComponent (legacy).
export function encodeAiwgDetailId(id: string, encoding: AiwgDetailIdEncoding = 'base64url'): string {
  if (encoding === 'uri') return encodeURIComponent(id)
  const bytes = new TextEncoder().encode(id)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  // btoa is available in browsers and Node ≥16.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Resolve a manifest detail.href template for a given id, honoring detail.encoding
// (absent → 'uri' for backward compatibility). The writer and the loader both go
// through this so emitted filenames and fetched paths always agree.
export function aiwgDetailHrefForId(detail: AiwgFortemiChunkDetailRef, id: string): string {
  return detail.href.replace('{id}', encodeAiwgDetailId(id, detail.encoding ?? 'uri'))
}

// Detail loader for projected indexes: resolves the manifest's detail.href {id}
// template (encoded per detail.encoding) against baseUrl and fetches the full record.
export function createAiwgFetchDetailLoader(baseUrl?: string | URL): AiwgChunkedIndexDetailLoader {
  return async (id, manifest) => {
    if (!manifest.detail?.href) throw new Error('Manifest has no detail.href for record resolution')
    const relative = aiwgDetailHrefForId(manifest.detail, id)
    const href = baseUrl ? new URL(relative, baseUrl).toString() : relative
    const response = await fetch(href)
    if (!response.ok) throw new Error('Failed to fetch AIWG index detail ' + href + ': ' + response.status)
    return response.json()
  }
}

export function getAiwgFortemiFacets(items: AiwgFortemiRecord[]): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {}
  for (const item of items) {
    pushFacet(result, 'type', item.type)
    pushFacet(result, 'privacy', item.privacy.classification)
    for (const tag of item.tags) pushFacet(result, 'tag', tag)
    for (const concept of item.concepts) pushFacet(result, 'concept', concept)
    for (const [name, values] of Object.entries(item.facets)) {
      for (const value of values) pushFacet(result, name, value)
    }
  }
  return result
}

export interface AiwgChunkedIndexBuildOptions {
  partSize?: number
  // When set, scan parts carry only these fields; full records go to `details`.
  projection?: Array<keyof AiwgFortemiRecord>
  // Detail href template (with {id}); defaults to "detail/{id}.json" when projecting.
  detailHref?: string
  // id→filename encoding for detail files; defaults to 'base64url' (path-safe,
  // works for ids containing '/'; see #177).
  idEncoding?: AiwgDetailIdEncoding
  generatedAt?: string
}

export interface AiwgChunkedIndexBuildResult {
  manifest: AiwgFortemiChunkManifest
  parts: Array<{ href: string; part: AiwgFortemiChunkPart }>
  // Empty unless projecting. Each entry carries the full record plus the resolved,
  // encoding-correct `href` to host it at — write the record to that path so the
  // detail loader (which uses the same encoding) can fetch it back.
  details: Array<{ id: string; href: string; record: AiwgFortemiRecord }>
}

// Pure builder (no I/O): project an index export into the chunked manifest + parts
// (+ detail records when projecting). The caller writes the returned objects to disk.
// Manifest facets are computed from the full records, so global counts are exact even
// when scan parts are slim.
export function buildAiwgChunkedIndex(
  index: AiwgFortemiIndexExport,
  options: AiwgChunkedIndexBuildOptions = {},
): AiwgChunkedIndexBuildResult {
  const partSize = hasPositiveInteger(options.partSize) ? options.partSize : 500
  const projection = options.projection
  const idEncoding = options.idEncoding ?? 'base64url'
  const detailHref = options.detailHref ?? 'detail/{id}.json'
  const items = index.items
  const pad = (value: number): string => String(value).padStart(4, '0')
  const project = (record: AiwgFortemiRecord): AiwgFortemiRecord => {
    if (!projection) return record
    const slim: Record<string, unknown> = {}
    for (const field of projection) slim[field] = record[field]
    return slim as unknown as AiwgFortemiRecord
  }

  const parts: Array<{ href: string; part: AiwgFortemiChunkPart }> = []
  const partRefs: AiwgFortemiChunkPartRef[] = []
  for (let offset = 0, partIndex = 0; offset < items.length; offset += partSize, partIndex += 1) {
    const slice = items.slice(offset, offset + partSize)
    const href = 'part-' + pad(partIndex) + '.json'
    parts.push({
      href,
      part: {
        schema_version: 'aiwg.fortemi.index.chunk.v1',
        manifest_schema_version: 'aiwg.fortemi.index.chunk-manifest.v1',
        offset,
        items: slice.map(project),
      },
    })
    partRefs.push({ href, offset, count: slice.length })
  }

  const manifest: AiwgFortemiChunkManifest = {
    schema_version: 'aiwg.fortemi.index.chunk-manifest.v1',
    generated_at: options.generatedAt ?? index.generated_at,
    source: index.source,
    total: items.length,
    part_size: partSize,
    facets: getAiwgFortemiFacets(items),
    parts: partRefs,
    ...(projection ? { projection, detail: { href: detailHref, encoding: idEncoding } } : {}),
  }

  return {
    manifest,
    parts,
    details: projection
      ? items.map((record) => ({
          id: record.id,
          href: aiwgDetailHrefForId({ href: detailHref, encoding: idEncoding }, record.id),
          record,
        }))
      : [],
  }
}

function includesAll(actual: string[], expected: string[] | undefined): boolean {
  if (!expected || expected.length === 0) return true
  const actualSet = new Set(actual)
  return expected.every((value) => actualSet.has(value))
}

function matchesFacetFilters(item: AiwgFortemiRecord, filters: Record<string, string[]> | undefined): boolean {
  if (!filters) return true
  return Object.entries(filters).every(([name, expected]) => includesAll(item.facets[name] ?? [], expected))
}

function queryMatches(item: AiwgFortemiRecord, q: string): AiwgIndexQueryMatch[] {
  if (!q) return []
  const matches: AiwgIndexQueryMatch[] = []
  if (item.title.toLowerCase().includes(q)) matches.push({ field: 'title', value: item.title })
  if (item.text.toLowerCase().includes(q)) matches.push({ field: 'text', value: item.text })
  for (const tag of item.tags) {
    if (tag.toLowerCase().includes(q)) matches.push({ field: 'tag', value: tag })
  }
  for (const concept of item.concepts) {
    if (concept.toLowerCase().includes(q)) matches.push({ field: 'concept', value: concept })
  }
  return matches
}

function rankMatches(matches: AiwgIndexQueryMatch[], weights: AiwgIndexQueryWeights): number {
  return matches.reduce((total, match) => total + weights[match.field], 0)
}

function clipSnippet(value: string, q: string, maxLength: number): string {
  const normalizedLength = Math.max(20, maxLength)
  if (!value) return ''
  if (!q) return value.length > normalizedLength ? `${value.slice(0, normalizedLength).trimEnd()}...` : value

  const lower = value.toLowerCase()
  const index = lower.indexOf(q)
  if (index < 0) return value.length > normalizedLength ? `${value.slice(0, normalizedLength).trimEnd()}...` : value

  const context = Math.max(0, Math.floor((normalizedLength - q.length) / 2))
  const start = Math.max(0, index - context)
  const end = Math.min(value.length, start + normalizedLength)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < value.length ? '...' : ''
  return `${prefix}${value.slice(start, end).trim()}${suffix}`
}

function createSnippet(item: AiwgFortemiRecord, matches: AiwgIndexQueryMatch[], q: string, maxLength: number): string {
  const textMatch = matches.find((match) => match.field === 'text')
  const titleMatch = matches.find((match) => match.field === 'title')
  const firstMatch = textMatch ?? titleMatch ?? matches[0]
  return clipSnippet(firstMatch?.value ?? item.text, q, maxLength)
}

interface AiwgRankedEntry {
  item: AiwgFortemiRecord
  ordinal: number
  rank: number
  matches: AiwgIndexQueryMatch[]
}

function createRankedEntries(
  items: AiwgFortemiRecord[],
  q: string,
  options: AiwgIndexQueryOptions,
  ordinalBase = 0,
): AiwgRankedEntry[] {
  const weights = { ...DEFAULT_QUERY_WEIGHTS, ...options.weights }
  return items.map((item, ordinal) => ({ item, ordinal: ordinalBase + ordinal, matches: queryMatches(item, q) }))
    .filter(({ item, matches }) => {
      if (q && matches.length === 0) return false
      if (options.types && !options.types.includes(item.type)) return false
      if (options.privacy && !options.privacy.includes(item.privacy.classification)) return false
      if (!includesAll(item.tags, options.tags)) return false
      if (!includesAll(item.concepts, options.concepts)) return false
      if (!matchesFacetFilters(item, options.facets)) return false
      if (options.relationshipTargetId && !(item.relationships ?? []).some((rel) => rel.target_id === options.relationshipTargetId)) {
        return false
      }
      return true
    })
    .map(({ item, ordinal, matches }) => ({
      item,
      ordinal,
      rank: rankMatches(matches, weights),
      matches,
    }))
}

function sortRankedEntries(entries: AiwgRankedEntry[], rank?: boolean): AiwgRankedEntry[] {
  return [...entries].sort((left, right) => {
    if (rank) return right.rank - left.rank || left.ordinal - right.ordinal
    return left.ordinal - right.ordinal
  })
}

function createQueryResultFromRankedEntries(
  entries: AiwgRankedEntry[],
  query: string,
  options: AiwgIndexQueryOptions,
): AiwgIndexQueryResult {
  const ranked = sortRankedEntries(entries, options.rank)
  const offset = options.offset ?? 0
  const limit = options.limit ?? ranked.length
  const page = ranked.slice(offset, offset + limit)
  const result: AiwgIndexQueryResult = {
    items: page.map((entry) => entry.item),
    total: ranked.length,
    facets: getAiwgFortemiFacets(ranked.map((entry) => entry.item)),
  }
  if (options.rank || options.snippets || options.includeMatches) {
    const snippetLength = options.snippetLength ?? 160
    result.rankedItems = page.map((entry) => ({
      item: entry.item,
      rank: entry.rank,
      ...(options.snippets ? { snippet: createSnippet(entry.item, entry.matches, query, snippetLength) } : {}),
      ...(options.includeMatches ? { matches: entry.matches } : {}),
    }))
  }
  return result
}

export function queryAiwgFortemiIndex(
  index: AiwgFortemiIndexExport,
  query = '',
  options: AiwgIndexQueryOptions = {},
): AiwgIndexQueryResult {
  const q = query.trim().toLowerCase()
  return createQueryResultFromRankedEntries(createRankedEntries(index.items, q, options), q, options)
}

interface AiwgChunkedIndexRuntime {
  manifest: AiwgFortemiChunkManifest
  loader: AiwgChunkedIndexLoader
  maxCachedParts: number
  partCache: Map<string, AiwgFortemiChunkPart>
  detailLoader?: AiwgChunkedIndexDetailLoader
  maxCachedDetails: number
  detailCache: Map<string, AiwgFortemiRecord>
  maxCachedMatches: number
  // query+filter+weights key -> the full filtered/ranked entry set for that
  // query (offset/limit/sort/snippets independent). LRU-ordered; bounded by
  // maxCachedMatches (total entries). Lets pagination reuse a single scan.
  matchCache: Map<string, AiwgRankedEntry[]>
}

function chunkPartCacheKey(part: AiwgFortemiChunkPartRef): string {
  return `${part.offset}:${part.href}`
}

function clampMaxCachedParts(value: number | undefined): number {
  if (!hasPositiveInteger(value)) return 3
  return value
}

function clampMaxCachedDetails(value: number | undefined): number {
  if (!hasPositiveInteger(value)) return 32
  return value
}

function clampMaxCachedMatches(value: number | undefined): number {
  if (!hasPositiveInteger(value)) return 5000
  return value
}

// Stable key over the inputs that determine the filtered/ranked entry SET and
// each entry's rank value — but not offset/limit/sort/snippets, which only shape
// the page projected from a cached set. Caller-stable option objects (same field
// order each page) hit the cache; a reordered object simply misses (still correct).
function matchSetCacheKey(q: string, options: AiwgIndexQueryOptions): string {
  return JSON.stringify({
    q,
    types: options.types ?? null,
    facets: options.facets ?? null,
    tags: options.tags ?? null,
    concepts: options.concepts ?? null,
    privacy: options.privacy ?? null,
    rel: options.relationshipTargetId ?? null,
    weights: { ...DEFAULT_QUERY_WEIGHTS, ...options.weights },
  })
}

function cacheMatchEntries(runtime: AiwgChunkedIndexRuntime, key: string, entries: AiwgRankedEntry[]): void {
  runtime.matchCache.delete(key)
  runtime.matchCache.set(key, entries)
  let total = 0
  for (const set of runtime.matchCache.values()) total += set.length
  // Evict oldest sets until within budget, but always keep the just-inserted set
  // so paging a large result still benefits from the single scan.
  while (total > runtime.maxCachedMatches && runtime.matchCache.size > 1) {
    const oldest = runtime.matchCache.keys().next().value
    if (oldest === undefined || oldest === key) break
    total -= runtime.matchCache.get(oldest)?.length ?? 0
    runtime.matchCache.delete(oldest)
  }
}

function isDirectChunkBrowse(query: string, options: AiwgIndexQueryOptions): boolean {
  return query.trim() === ''
    && !options.rank
    && !options.snippets
    && !options.includeMatches
    && !options.types
    && !options.facets
    && !options.tags
    && !options.concepts
    && !options.privacy
    && !options.relationshipTargetId
}

function getPartsForRange(
  manifest: AiwgFortemiChunkManifest,
  offset: number,
  limit: number,
): AiwgFortemiChunkPartRef[] {
  const end = offset + limit
  return manifest.parts.filter((part) => part.count > 0 && part.offset < end && part.offset + part.count > offset)
}

async function loadChunkPart(
  runtime: AiwgChunkedIndexRuntime,
  part: AiwgFortemiChunkPartRef,
): Promise<{ part: AiwgFortemiChunkPart; fetched: boolean }> {
  const key = chunkPartCacheKey(part)
  const cached = runtime.partCache.get(key)
  if (cached) {
    runtime.partCache.delete(key)
    runtime.partCache.set(key, cached)
    return { part: cached, fetched: false }
  }

  const parsed = assertAiwgFortemiChunkPart(await runtime.loader(part, runtime.manifest), part, runtime.manifest)
  runtime.partCache.set(key, parsed)
  while (runtime.partCache.size > runtime.maxCachedParts) {
    const oldest = runtime.partCache.keys().next().value
    if (oldest === undefined) break
    runtime.partCache.delete(oldest)
  }
  return { part: parsed, fetched: true }
}

async function getChunkRecord(runtime: AiwgChunkedIndexRuntime, id: string): Promise<AiwgFortemiRecord> {
  const cached = runtime.detailCache.get(id)
  if (cached) {
    runtime.detailCache.delete(id)
    runtime.detailCache.set(id, cached)
    return cached
  }
  // Whole-record parts already in cache: serve without a detail fetch.
  if (!runtime.manifest.projection) {
    for (const part of runtime.partCache.values()) {
      const found = part.items.find((item) => item.id === id)
      if (found) return found
    }
  }
  if (!runtime.detailLoader) {
    throw new Error('No detailLoader configured to resolve record ' + id)
  }
  const raw = await runtime.detailLoader(id, runtime.manifest)
  const record = assertAiwgFortemiIndexExport({
    schema_version: 'aiwg.fortemi.index.export.v1',
    generated_at: runtime.manifest.generated_at,
    source: runtime.manifest.source,
    items: [raw],
  }).items[0]
  if (record.id !== id) {
    throw new Error('Detail record id mismatch: expected ' + id + ', got ' + record.id)
  }
  runtime.detailCache.set(id, record)
  while (runtime.detailCache.size > runtime.maxCachedDetails) {
    const oldest = runtime.detailCache.keys().next().value
    if (oldest === undefined) break
    runtime.detailCache.delete(oldest)
  }
  return record
}

async function queryChunkedAiwgFortemiIndex(
  runtime: AiwgChunkedIndexRuntime,
  query = '',
  options: AiwgChunkedIndexQueryOptions = {},
): Promise<AiwgChunkedIndexQueryResult> {
  const q = query.trim().toLowerCase()
  let scannedParts = 0
  let fetchedParts = 0

  if (isDirectChunkBrowse(query, options)) {
    const offset = options.offset ?? 0
    const limit = options.limit ?? runtime.manifest.total
    const parts = getPartsForRange(runtime.manifest, offset, limit)
    const items: AiwgFortemiRecord[] = []
    for (const partRef of parts) {
      const loaded = await loadChunkPart(runtime, partRef)
      if (loaded.fetched) fetchedParts += 1
      scannedParts += 1
      options.onProgress?.({ phase: 'part', done: scannedParts, total: parts.length, href: partRef.href })
      const start = Math.max(0, offset - partRef.offset)
      const end = Math.min(loaded.part.items.length, offset + limit - partRef.offset)
      items.push(...loaded.part.items.slice(start, end))
    }
    return {
      items,
      total: runtime.manifest.total,
      facets: runtime.manifest.facets ?? {},
      manifestTotal: runtime.manifest.total,
      scannedParts,
      fetchedParts,
      complete: true,
    }
  }

  // Reuse the filtered/ranked entry set across pages of the same query: the
  // expensive part scan is offset/limit/sort/snippet independent. A hit projects
  // a new page from cached entries without touching parts (scanned/fetched = 0).
  const matchKey = matchSetCacheKey(q, options)
  const cached = runtime.matchCache.get(matchKey)
  if (cached) {
    runtime.matchCache.delete(matchKey)
    runtime.matchCache.set(matchKey, cached)
    return {
      ...createQueryResultFromRankedEntries(cached, q, options),
      manifestTotal: runtime.manifest.total,
      scannedParts: 0,
      fetchedParts: 0,
      complete: true,
    }
  }

  const entries: AiwgRankedEntry[] = []
  for (const partRef of runtime.manifest.parts) {
    const loaded = await loadChunkPart(runtime, partRef)
    if (loaded.fetched) fetchedParts += 1
    scannedParts += 1
    options.onProgress?.({ phase: 'part', done: scannedParts, total: runtime.manifest.parts.length, href: partRef.href })
    entries.push(...createRankedEntries(loaded.part.items, q, options, partRef.offset))
    options.onProgress?.({ phase: 'query', done: scannedParts, total: runtime.manifest.parts.length, href: partRef.href })
  }
  cacheMatchEntries(runtime, matchKey, entries)

  return {
    ...createQueryResultFromRankedEntries(entries, q, options),
    manifestTotal: runtime.manifest.total,
    scannedParts,
    fetchedParts,
    complete: true,
  }
}

export function createAiwgReviewDecisionExport(
  // Only the export schema_version is needed — so this works in chunked mode
  // (where no whole index is loaded) by passing a minimal source. See #178.
  source: Pick<AiwgFortemiIndexExport, 'schema_version'>,
  decisions: AiwgReviewDecision[],
  generatedAt = new Date().toISOString(),
): AiwgReviewDecisionExport {
  return {
    schema_version: 'aiwg.fortemi.review-decisions.v1',
    generated_at: generatedAt,
    source_export_schema_version: source.schema_version,
    decisions: [...decisions].sort((left, right) => left.item_id.localeCompare(right.item_id)),
  }
}

export function createAiwgIndexController(initialIndex?: AiwgFortemiIndexExport): AiwgIndexController {
  let index: AiwgFortemiIndexExport | null = initialIndex ?? null
  let chunked: AiwgChunkedIndexRuntime | null = null
  let data: AiwgIndexQueryResult | null = null
  let error: Error | null = null
  let reviewDecisions: AiwgReviewDecision[] = []
  const listeners = new Set<AiwgIndexControllerListener>()

  const snapshot = (): AiwgIndexControllerSnapshot => ({
    index,
    chunked: chunked
      ? {
          manifest: chunked.manifest,
          cachedParts: chunked.partCache.size,
          maxCachedParts: chunked.maxCachedParts,
        }
      : null,
    data,
    error,
    reviewDecisions: [...reviewDecisions],
  })
  const notify = () => {
    const current = snapshot()
    for (const listener of listeners) listener(current)
  }
  const requireIndex = (): AiwgFortemiIndexExport => {
    if (!index) throw new Error('No AIWG index export loaded')
    return index
  }

  return {
    loadIndex(value: unknown): AiwgFortemiIndexExport {
      try {
        const parsed = assertAiwgFortemiIndexExport(value)
        index = parsed
        chunked = null
        data = null
        reviewDecisions = []
        error = null
        notify()
        return parsed
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err))
        notify()
        throw error
      }
    },
    loadChunkedIndex(
      manifest: unknown,
      loader: AiwgChunkedIndexLoader,
      options: AiwgChunkedIndexLoadOptions = {},
    ): AiwgFortemiChunkManifest {
      try {
        const parsed = assertAiwgFortemiChunkManifest(manifest)
        index = null
        chunked = {
          manifest: parsed,
          loader,
          maxCachedParts: clampMaxCachedParts(options.maxCachedParts),
          partCache: new Map(),
          detailLoader: options.detailLoader,
          maxCachedDetails: clampMaxCachedDetails(options.maxCachedDetails),
          detailCache: new Map(),
          maxCachedMatches: clampMaxCachedMatches(options.maxCachedMatches),
          matchCache: new Map(),
        }
        data = null
        reviewDecisions = []
        error = null
        notify()
        return parsed
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err))
        notify()
        throw error
      }
    },
    getIndex(): AiwgFortemiIndexExport | null {
      return index
    },
    getChunkedManifest(): AiwgFortemiChunkManifest | null {
      return chunked?.manifest ?? null
    },
    getSnapshot(): AiwgIndexControllerSnapshot {
      return snapshot()
    },
    query(query = '', options?: AiwgIndexQueryOptions): AiwgIndexQueryResult {
      const result = queryAiwgFortemiIndex(requireIndex(), query, options)
      data = result
      error = null
      notify()
      return result
    },
    async queryChunked(query = '', options?: AiwgChunkedIndexQueryOptions): Promise<AiwgChunkedIndexQueryResult> {
      if (!chunked) throw new Error('No AIWG chunked index manifest loaded')
      try {
        const result = await queryChunkedAiwgFortemiIndex(chunked, query, options)
        data = result
        error = null
        notify()
        return result
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err))
        notify()
        throw error
      }
    },
    async getRecord(id: string): Promise<AiwgFortemiRecord> {
      if (chunked) {
        try {
          return await getChunkRecord(chunked, id)
        } catch (err) {
          error = err instanceof Error ? err : new Error(String(err))
          notify()
          throw error
        }
      }
      const found = requireIndex().items.find((item) => item.id === id)
      if (!found) throw new Error('Record not found: ' + id)
      return found
    },
    clearChunkCache(): void {
      chunked?.partCache.clear()
      chunked?.detailCache.clear()
      chunked?.matchCache.clear()
      error = null
      notify()
    },
    toCommunityGraph(options?: AiwgIndexGraphOptions) {
      return aiwgFortemiIndexToCommunityGraph(requireIndex(), options)
    },
    setReviewDecision(input: AiwgReviewInput): AiwgReviewDecision {
      const decision: AiwgReviewDecision = {
        ...input,
        updated_at: new Date().toISOString(),
      }
      reviewDecisions = [
        ...reviewDecisions.filter((item) => item.item_id !== decision.item_id),
        decision,
      ].sort((left, right) => left.item_id.localeCompare(right.item_id))
      error = null
      notify()
      return decision
    },
    clearReviewDecision(itemId: string): void {
      reviewDecisions = reviewDecisions.filter((item) => item.item_id !== itemId)
      error = null
      notify()
    },
    createReviewDecisionExport(generatedAt?: string): AiwgReviewDecisionExport {
      // The review-decisions export only needs the export schema_version, not the
      // items — so it works in chunked mode by synthesizing a minimal source (#178).
      const source: Pick<AiwgFortemiIndexExport, 'schema_version'> | null =
        index ?? (chunked ? { schema_version: 'aiwg.fortemi.index.export.v1' } : null)
      if (!source) throw new Error('No AIWG index export or chunked manifest loaded')
      return createAiwgReviewDecisionExport(source, reviewDecisions, generatedAt)
    },
    subscribe(listener: AiwgIndexControllerListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function aiwgFortemiIndexToCommunityGraph(
  index: AiwgFortemiIndexExport,
  options: AiwgIndexGraphOptions = {},
) {
  const ids = new Set(index.items.map((item) => item.id))
  const relationshipWeights = options.relationshipWeights ?? {}
  const edgeCounts = new Map<string, { source: string; target: string; kind: string; weight: number }>()

  for (const item of index.items) {
    for (const relationship of item.relationships) {
      if (!ids.has(relationship.target_id) && !options.includeDanglingRelationships) continue
      const kind = relationship.type
      const baseWeight = relationshipWeights[kind] ?? 1
      const key = `${item.id}\u0000${relationship.target_id}\u0000${kind}`
      const existing = edgeCounts.get(key)
      if (existing) existing.weight += baseWeight
      else edgeCounts.set(key, { source: item.id, target: relationship.target_id, kind, weight: baseWeight })
    }
  }

  const communities = new Map<string, string[]>()
  for (const item of index.items) {
    const communityIds = communityIdsFor(item, options)
    for (const communityId of communityIds) {
      const nodes = communities.get(communityId) ?? []
      nodes.push(item.id)
      communities.set(communityId, nodes)
    }
  }

  return {
    nodes: index.items.map((item) => ({ id: item.id })),
    edges: Array.from(edgeCounts.values()).sort((left, right) => (
      left.source.localeCompare(right.source)
      || left.target.localeCompare(right.target)
      || left.kind.localeCompare(right.kind)
    )),
    communities: Array.from(communities.entries())
      .map(([id, nodes]) => ({ id, nodes: [...new Set(nodes)].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function communityIdsFor(item: AiwgFortemiRecord, options: AiwgIndexGraphOptions): string[] {
  if (options.communityFacet) {
    const values = item.facets[options.communityFacet] ?? []
    if (values.length > 0) return values.map((value) => `${options.communityFacet}:${value}`)
  }
  if (options.communityTagPrefix) {
    const prefix = options.communityTagPrefix
    const tags = item.tags.filter((tag) => tag.startsWith(prefix))
    if (tags.length > 0) return tags
  }
  if (item.concepts.length > 0) return item.concepts.map((concept) => `concept:${concept}`)
  return [`type:${item.type}`]
}
