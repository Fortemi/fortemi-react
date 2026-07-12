import { computeHash } from './hash.js'

export type AiwgFortemiKnownRecordType =
  | 'crm.contact'
  | 'crm.organization'
  | 'crm.event'
  | 'crm.interaction'
  | 'aiwg.artifact'
  | 'aiwg.kb.page'

export type AiwgFortemiRecordType = AiwgFortemiKnownRecordType | `aiwg.${string}` | `research.${string}` | `docs.${string}` | string

export type AiwgFortemiRecordSchemaVersion = 'aiwg.fortemi.index.record.v1' | 'aiwg.fortemi.index.record.v2'
export type AiwgFortemiIndexExportSchemaVersion = 'aiwg.fortemi.index.export.v1' | 'aiwg.fortemi.index.export.v2'
export type AiwgPrivacyClassification = 'private' | 'sanitized' | 'public'
export type AiwgProvenanceConfidence = 'source' | 'candidate' | 'reviewed' | 'rejected'
export type AiwgReviewAction = 'accept' | 'reject' | 'defer'
export type AiwgFortemiRelationshipDirection = 'upstream' | 'downstream' | 'related'

export interface AiwgFortemiRecordSource {
  path: string
  repo_relative_path: string
  locator: string
  origin?: string
  generated?: boolean
  checksum?: string
  updated_at?: string
}

export interface AiwgFortemiRelationship {
  type: string
  target_id: string
  source_path?: string
  target_path?: string
  direction?: AiwgFortemiRelationshipDirection
  label?: string
  confidence?: number
  privacy?: AiwgPrivacyClassification
  metadata?: Record<string, unknown>
}

export interface AiwgFortemiProvenance {
  field: string
  source: string
  path: string
  confidence: AiwgProvenanceConfidence
  privacy: AiwgPrivacyClassification
}

export type AiwgFortemiSkosRelationType = 'broader' | 'narrower' | 'related' | string

export interface AiwgFortemiSkosConcept {
  id: string
  prefLabel: string
  definition?: string
  scheme?: string
  notation?: string
  uri?: string
  altLabels?: string[]
  metadata?: Record<string, unknown>
}

export interface AiwgFortemiSkosRelation {
  type: AiwgFortemiSkosRelationType
  source_id: string
  target_id: string
  source_path?: string
  metadata?: Record<string, unknown>
}

export interface AiwgFortemiProvenanceEvent {
  id?: string
  activity: string
  agent?: string
  started_at?: string
  ended_at?: string
  source?: string
  path?: string
  confidence?: AiwgProvenanceConfidence
  privacy?: AiwgPrivacyClassification
  attributes?: Record<string, unknown>
}

export interface AiwgFortemiSearchProjection {
  title?: string
  name?: string
  summary?: string
  body?: string
  triggers?: string[]
  aliases?: string[]
  capability?: string
  tags?: string[]
  phase?: string
  type?: string
  frontmatter?: Record<string, unknown>
}

export interface AiwgFortemiChunk {
  id?: string
  text?: string
  body?: string
  summary?: string
  source_path?: string
  metadata?: Record<string, unknown>
}

export interface AiwgFortemiRecordEmbedding {
  id?: string
  embedding?: number[]
  vector?: number[]
  model?: string
  granularity?: string
  input_hash?: string
  source_path?: string
  metadata?: Record<string, unknown>
}

export interface AiwgFortemiAttachmentReference {
  id: string
  path: string
  mime: string | null
  checksum: string
  bytes: number
}

export interface AiwgFortemiBinarySource {
  extracted_text: string
  attachment: AiwgFortemiAttachmentReference
}

export interface AiwgFortemiRecord {
  schema_version: AiwgFortemiRecordSchemaVersion
  id: string
  type: AiwgFortemiRecordType
  source: AiwgFortemiRecordSource
  title?: string
  text?: string
  facets: Record<string, string[]>
  tags: string[]
  concepts: string[]
  relationships: AiwgFortemiRelationship[]
  provenance: AiwgFortemiProvenance[]
  search?: AiwgFortemiSearchProjection
  chunks?: AiwgFortemiChunk[]
  binary_sources?: AiwgFortemiBinarySource[]
  embeddings?: AiwgFortemiRecordEmbedding[]
  compatibility?: Record<string, unknown>
  /** Optional rich SKOS metadata for static consumers that need labels/definitions without opening a shard. */
  skos_concepts?: AiwgFortemiSkosConcept[]
  /** Optional SKOS relationship edges among concepts referenced by this record. */
  skos_relations?: AiwgFortemiSkosRelation[]
  /** Optional W3C PROV-style activity chain for this record. */
  provenance_events?: AiwgFortemiProvenanceEvent[]
  privacy: {
    classification: AiwgPrivacyClassification
    pii: boolean
    locality?: string
  }
  updated_at: string
}

export interface AiwgFortemiIndexExport {
  schema_version: AiwgFortemiIndexExportSchemaVersion
  generated_at: string
  source: {
    repo: string
    privacy: AiwgPrivacyClassification
    // v2-only graph metadata block; the validator gates its presence to export.v2.
    graph?: Record<string, unknown>
  }
  items: AiwgFortemiRecord[]
  // v2-only; the validator gates its presence to export.v2.
  compatibility?: Record<string, unknown>
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
  // The schema_version of the source index export this manifest was built from,
  // so chunked consumers (e.g. review-decision export) can report the true source
  // version rather than assuming v1 (#239 E8). Optional for backward compatibility.
  source_export_schema_version?: AiwgFortemiIndexExportSchemaVersion
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
  counts: Partial<Record<string, number>>
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
  searchProfile?: 'default' | 'aiwg-discovery'
}

export interface AiwgIndexQueryWeights {
  title: number
  text: number
  tag: number
  concept: number
  facet: number
  id: number
  source: number
}

export interface AiwgIndexQueryMatch {
  field: 'title' | 'text' | 'tag' | 'concept' | 'facet' | 'id' | 'source'
  value: string
  score?: number
  reason?: string
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

export type AiwgRelationshipDirection = 'in' | 'out' | 'both'
export type AiwgRelationshipSetOperation = 'intersection' | 'union' | 'difference'

export interface AiwgRelationshipTraversalOptions {
  direction?: AiwgRelationshipDirection
  relationshipType?: string
  relationshipDirection?: AiwgFortemiRelationshipDirection
  limit?: number
}

export interface AiwgRelationshipQueryOptions extends AiwgRelationshipTraversalOptions {
  sourceId?: string
  targetId?: string
  endpointId?: string
  type?: string
}

export interface AiwgRelationshipEdgeSummary {
  source_id: string
  target_id: string
  type: string
  source_path?: string
  target_path?: string
  direction?: AiwgFortemiRelationshipDirection
}

export interface AiwgRelationshipNodeSummary {
  id: string
  type: AiwgFortemiRecordType
  title: string
}

export interface AiwgRelationshipTraversalResult {
  nodes: AiwgRelationshipNodeSummary[]
  edges: AiwgRelationshipEdgeSummary[]
  complete: boolean
  scannedParts?: number
  fetchedParts?: number
}

export interface AiwgRelationshipSetOptions extends AiwgRelationshipTraversalOptions {
  op: AiwgRelationshipSetOperation
  a: string
  b: string
}

export interface AiwgRelationshipSetResult {
  ids: string[]
  op: AiwgRelationshipSetOperation
}

export interface AiwgStaticEmbeddingRecord {
  record_id: string
  embedding: number[]
  embedding_id?: string
  granularity?: string
  input_hash: string
  source_path?: string
}

export interface AiwgStaticEmbeddingSet {
  schema_version: 'aiwg.fortemi.embedding.set.v1'
  id: string
  model: string
  dimensions: number
  generated_at: string
  granularity: 'title-summary' | 'body' | 'chunked-body' | string
  metric?: 'cosine' | 'dot' | 'euclidean'
  input_hash_algorithm?: string
  embeddings: AiwgStaticEmbeddingRecord[]
}

export interface AiwgHeadlessEmbeddingBackend {
  model: string
  dimensions: number
  embed(input: string, record: AiwgFortemiRecord): number[] | Promise<number[]>
}

// Privacy filtering for generated index/embedding artifacts (SEC6). Generation
// is default-safe: records classified `private`, or flagged `pii`, are excluded
// unless the caller explicitly opts them in. This keeps the query-time privacy
// gate from being the *only* enforcement point — a leaked embedding set or scan
// part can no longer carry private/PII-derived vectors by default.
export interface AiwgPrivacyFilterOptions {
  /** Include records classified `private` (default false). */
  includePrivate?: boolean
  /** Include records flagged `pii` (default false). */
  includePii?: boolean
}

function isPrivacyExcluded(record: AiwgFortemiRecord, options?: AiwgPrivacyFilterOptions): boolean {
  const privacy = record.privacy
  if (!privacy) return false
  if (privacy.classification === 'private' && !options?.includePrivate) return true
  if (privacy.pii && !options?.includePii) return true
  return false
}

/** Drop `private`/`pii` records unless explicitly opted in (SEC6, default-safe). */
export function filterAiwgRecordsByPrivacy(
  records: AiwgFortemiRecord[],
  options?: AiwgPrivacyFilterOptions,
): AiwgFortemiRecord[] {
  return records.filter((record) => !isPrivacyExcluded(record, options))
}

export interface BuildAiwgStaticEmbeddingSetOptions {
  id: string
  backend: AiwgHeadlessEmbeddingBackend
  records?: AiwgFortemiRecord[]
  generatedAt?: string | Date
  granularity?: AiwgStaticEmbeddingSet['granularity']
  metric?: AiwgStaticEmbeddingSet['metric']
  textForRecord?: (record: AiwgFortemiRecord) => string
  /** Privacy filtering (SEC6). Default-safe: excludes `private`/`pii` records. */
  privacy?: AiwgPrivacyFilterOptions
}

export interface AiwgStaticSemanticQueryOptions {
  limit?: number
  offset?: number
  minScore?: number
}

export interface AiwgStaticSemanticResult {
  item: AiwgFortemiRecord
  score: number
  embedding?: AiwgStaticEmbeddingRecord
}

export interface AiwgStaticHybridQueryOptions extends AiwgStaticSemanticQueryOptions, AiwgIndexQueryOptions {
  lexicalWeight?: number
  semanticWeight?: number
}

export interface AiwgStaticDuplicatePair {
  left: AiwgFortemiRecord
  right: AiwgFortemiRecord
  score: number
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
  neighbors(id: string, options?: AiwgRelationshipTraversalOptions): Promise<AiwgRelationshipTraversalResult>
  relationshipQuery(options?: AiwgRelationshipQueryOptions): Promise<AiwgRelationshipTraversalResult>
  relationshipSet(options: AiwgRelationshipSetOptions): Promise<AiwgRelationshipSetResult>
  clearChunkCache(): void
  toCommunityGraph(options?: AiwgIndexGraphOptions): ReturnType<typeof aiwgFortemiIndexToCommunityGraph>
  toCommunityGraphChunked(options?: AiwgIndexGraphOptions & { onProgress?: (progress: AiwgChunkedIndexProgress) => void }): Promise<ReturnType<typeof aiwgFortemiIndexToCommunityGraph>>
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
  'facets',
  'tags',
  'concepts',
  'relationships',
  'provenance',
  'privacy',
  'updated_at',
]

const DEFAULT_QUERY_WEIGHTS: AiwgIndexQueryWeights = {
  title: 4,
  tag: 3,
  concept: 2,
  text: 1,
  facet: 2,
  id: 1,
  source: 0.25,
}

function hasString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function pushFacet(counts: Record<string, Record<string, number>>, name: string, value: string) {
  // `name`/`value` come from untrusted index records (item.facets). Using a
  // prototype-bearing accumulator would let a key such as `__proto__` (or any
  // inherited name like `toString`) read through the prototype chain and mutate
  // shared built-ins. Null-prototype buckets make every access own-property
  // only, so exotic keys are counted as plain data. See SEC1 / #236.
  let bucket = counts[name]
  if (bucket === undefined) {
    bucket = Object.create(null) as Record<string, number>
    counts[name] = bucket
  }
  bucket[value] = (bucket[value] ?? 0) + 1
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
}

function isSupportedIndexSchemaVersion(value: unknown): value is AiwgFortemiIndexExportSchemaVersion {
  return value === 'aiwg.fortemi.index.export.v1' || value === 'aiwg.fortemi.index.export.v2'
}

function isSupportedRecordSchemaVersion(value: unknown): value is AiwgFortemiRecordSchemaVersion {
  return value === 'aiwg.fortemi.index.record.v1' || value === 'aiwg.fortemi.index.record.v2'
}

function validateOptionalRichMetadata(item: Partial<AiwgFortemiRecord>, index: number, errors: string[]): void {
  if (item.skos_concepts !== undefined) {
    if (!Array.isArray(item.skos_concepts)) {
      errors.push('items[' + index + '].skos_concepts must be an array when present')
    } else {
      for (const [conceptIndex, concept] of item.skos_concepts.entries()) {
        if (!hasString(concept.id)) errors.push('items[' + index + '].skos_concepts[' + conceptIndex + '].id is required')
        if (!hasString(concept.prefLabel)) errors.push('items[' + index + '].skos_concepts[' + conceptIndex + '].prefLabel is required')
        if (!isOptionalStringArray(concept.altLabels)) errors.push('items[' + index + '].skos_concepts[' + conceptIndex + '].altLabels must be a string array')
        if (concept.metadata !== undefined && !isPlainRecord(concept.metadata)) {
          errors.push('items[' + index + '].skos_concepts[' + conceptIndex + '].metadata must be an object')
        }
      }
    }
  }
  if (item.skos_relations !== undefined) {
    if (!Array.isArray(item.skos_relations)) {
      errors.push('items[' + index + '].skos_relations must be an array when present')
    } else {
      for (const [relationIndex, relation] of item.skos_relations.entries()) {
        if (!hasString(relation.type)) errors.push('items[' + index + '].skos_relations[' + relationIndex + '].type is required')
        if (!hasString(relation.source_id)) errors.push('items[' + index + '].skos_relations[' + relationIndex + '].source_id is required')
        if (!hasString(relation.target_id)) errors.push('items[' + index + '].skos_relations[' + relationIndex + '].target_id is required')
        if (relation.metadata !== undefined && !isPlainRecord(relation.metadata)) {
          errors.push('items[' + index + '].skos_relations[' + relationIndex + '].metadata must be an object')
        }
      }
    }
  }
  if (item.provenance_events !== undefined) {
    if (!Array.isArray(item.provenance_events)) {
      errors.push('items[' + index + '].provenance_events must be an array when present')
    } else {
      for (const [eventIndex, event] of item.provenance_events.entries()) {
        if (!hasString(event.activity)) errors.push('items[' + index + '].provenance_events[' + eventIndex + '].activity is required')
        if (event.attributes !== undefined && !isPlainRecord(event.attributes)) {
          errors.push('items[' + index + '].provenance_events[' + eventIndex + '].attributes must be an object')
        }
      }
    }
  }
  if (Array.isArray(item.relationships)) {
    for (const [relationshipIndex, relationship] of item.relationships.entries()) {
      if (relationship.metadata !== undefined && !isPlainRecord(relationship.metadata)) {
        errors.push('items[' + index + '].relationships[' + relationshipIndex + '].metadata must be an object')
      }
      if (
        relationship.direction !== undefined &&
        relationship.direction !== 'upstream' &&
        relationship.direction !== 'downstream' &&
        relationship.direction !== 'related'
      ) {
        errors.push('items[' + index + '].relationships[' + relationshipIndex + '].direction must be upstream, downstream, or related')
      }
      if (relationship.target_path !== undefined && typeof relationship.target_path !== 'string') {
        errors.push('items[' + index + '].relationships[' + relationshipIndex + '].target_path must be a string')
      }
    }
  }
  if (item.search !== undefined) {
    if (!isPlainRecord(item.search)) {
      errors.push('items[' + index + '].search must be an object')
    } else {
      if (!isOptionalStringArray(item.search.triggers)) errors.push('items[' + index + '].search.triggers must be a string array')
      if (!isOptionalStringArray(item.search.aliases)) errors.push('items[' + index + '].search.aliases must be a string array')
      if (!isOptionalStringArray(item.search.tags)) errors.push('items[' + index + '].search.tags must be a string array')
      if (item.search.frontmatter !== undefined && !isPlainRecord(item.search.frontmatter)) {
        errors.push('items[' + index + '].search.frontmatter must be an object')
      }
    }
  }
  if (item.chunks !== undefined) {
    if (!Array.isArray(item.chunks)) {
      errors.push('items[' + index + '].chunks must be an array when present')
    } else {
      for (const [chunkIndex, chunk] of item.chunks.entries()) {
        if (!isPlainRecord(chunk)) errors.push('items[' + index + '].chunks[' + chunkIndex + '] must be an object')
        if (chunk.metadata !== undefined && !isPlainRecord(chunk.metadata)) {
          errors.push('items[' + index + '].chunks[' + chunkIndex + '].metadata must be an object')
        }
      }
    }
  }
  if (item.embeddings !== undefined) {
    if (!Array.isArray(item.embeddings)) {
      errors.push('items[' + index + '].embeddings must be an array when present')
    } else {
      for (const [embeddingIndex, embedding] of item.embeddings.entries()) {
        if (!isPlainRecord(embedding)) errors.push('items[' + index + '].embeddings[' + embeddingIndex + '] must be an object')
        const vector = embedding.embedding ?? embedding.vector
        if (vector !== undefined && (!Array.isArray(vector) || !vector.every((entry) => typeof entry === 'number'))) {
          errors.push('items[' + index + '].embeddings[' + embeddingIndex + '].embedding/vector must be a number array')
        }
        if (embedding.metadata !== undefined && !isPlainRecord(embedding.metadata)) {
          errors.push('items[' + index + '].embeddings[' + embeddingIndex + '].metadata must be an object')
        }
      }
    }
  }
  if (item.compatibility !== undefined && !isPlainRecord(item.compatibility)) {
    errors.push('items[' + index + '].compatibility must be an object')
  }
}

function isPrivacyClassification(value: unknown): value is AiwgPrivacyClassification {
  return value === 'private' || value === 'sanitized' || value === 'public'
}

function isProvenanceConfidence(value: unknown): value is AiwgProvenanceConfidence {
  return value === 'source' || value === 'candidate' || value === 'reviewed' || value === 'rejected'
}

// Provenance item shape + enum validation (#239 A4). Each item requires
// field/source/path and enum-valid confidence/privacy — the schema marks all five
// required, but the parser previously only checked "non-empty array".
function validateProvenanceItems(item: Partial<AiwgFortemiRecord>, index: number, errors: string[]): void {
  if (!Array.isArray(item.provenance)) return
  for (const [provIndex, prov] of item.provenance.entries()) {
    const at = 'items[' + index + '].provenance[' + provIndex + ']'
    if (!isPlainRecord(prov)) {
      errors.push(at + ' must be an object')
      continue
    }
    if (!hasString(prov.field)) errors.push(at + '.field is required')
    if (!hasString(prov.source)) errors.push(at + '.source is required')
    if (!hasString(prov.path)) errors.push(at + '.path is required')
    if (!isProvenanceConfidence(prov.confidence)) errors.push(at + '.confidence must be one of source, candidate, reviewed, rejected')
    if (!isPrivacyClassification(prov.privacy)) errors.push(at + '.privacy must be one of private, sanitized, public')
  }
}

// v1/v2 field forbiddance (#239 A2): a record.v1 record must not carry fields the
// schema defines only for record.v2. Keeps the parser as strict as the schema, so
// a too-loose generator output is rejected rather than silently accepted.
const V2_ONLY_RECORD_FIELDS = ['search', 'chunks', 'embeddings', 'skos_concepts', 'skos_relations', 'compatibility'] as const
const V2_ONLY_SOURCE_FIELDS = ['origin', 'generated', 'checksum', 'updated_at'] as const
const V2_ONLY_RELATIONSHIP_FIELDS = ['target_path', 'direction', 'metadata'] as const

function forbidV2FieldsOnV1Record(item: Partial<AiwgFortemiRecord>, index: number, errors: string[]): void {
  if (item.schema_version !== 'aiwg.fortemi.index.record.v1') return
  const at = 'items[' + index + ']'
  const bag = item as Record<string, unknown>
  const v2msg = ' is a v2-only field and must be absent on a record.v1 record'
  for (const field of V2_ONLY_RECORD_FIELDS) {
    if (bag[field] !== undefined) errors.push(at + '.' + field + v2msg)
  }
  if (isPlainRecord(item.source)) {
    const src = item.source as Record<string, unknown>
    for (const field of V2_ONLY_SOURCE_FIELDS) {
      if (src[field] !== undefined) errors.push(at + '.source.' + field + v2msg)
    }
  }
  if (isPlainRecord(item.privacy) && (item.privacy as Record<string, unknown>).locality !== undefined) {
    errors.push(at + '.privacy.locality' + v2msg)
  }
  if (Array.isArray(item.relationships)) {
    for (const [relIndex, rel] of item.relationships.entries()) {
      if (!isPlainRecord(rel)) continue
      const relBag = rel as Record<string, unknown>
      for (const field of V2_ONLY_RELATIONSHIP_FIELDS) {
        if (relBag[field] !== undefined) errors.push(at + '.relationships[' + relIndex + '].' + field + v2msg)
      }
    }
  }
}

export function validateAiwgFortemiIndexExport(value: unknown): AiwgIndexValidationResult {
  const errors: string[] = []
  const counts: Partial<Record<string, number>> = {}
  const data = value as Partial<AiwgFortemiIndexExport>

  if (!isSupportedIndexSchemaVersion(data?.schema_version)) {
    errors.push('schema_version must be aiwg.fortemi.index.export.v1 or aiwg.fortemi.index.export.v2')
  }
  if (!hasString(data?.generated_at)) errors.push('generated_at is required')
  if (!hasString(data?.source?.repo)) errors.push('source.repo is required')
  if (!hasString(data?.source?.privacy)) errors.push('source.privacy is required')
  else if (!isPrivacyClassification(data?.source?.privacy)) {
    errors.push('source.privacy must be one of private, sanitized, public')
  }
  if (!Array.isArray(data?.items)) errors.push('items must be an array')
  if (data.compatibility !== undefined && !isPlainRecord(data.compatibility)) {
    errors.push('compatibility must be an object')
  }
  // A5: export-level v1/v2 gating — source.graph and compatibility are v2-only.
  if (data?.schema_version === 'aiwg.fortemi.index.export.v1') {
    if (isPlainRecord(data.source) && (data.source as Record<string, unknown>).graph !== undefined) {
      errors.push('source.graph is a v2-only field and must be absent on an export.v1 export')
    }
    if (data.compatibility !== undefined) {
      errors.push('compatibility is a v2-only field and must be absent on an export.v1 export')
    }
  }

  const ids = new Set<string>()
  let previousId = ''
  for (const [index, item] of (data.items ?? []).entries()) {
    for (const field of REQUIRED_RECORD_FIELDS) {
      if (!(field in item)) errors.push('items[' + index + '].' + field + ' is required')
    }
    if (!isSupportedRecordSchemaVersion(item.schema_version)) {
      errors.push('items[' + index + '].schema_version must be aiwg.fortemi.index.record.v1 or aiwg.fortemi.index.record.v2')
    }
    if (!hasString(item.id)) errors.push('items[' + index + '].id is required')
    if (hasString(item.id) && ids.has(item.id)) errors.push('duplicate id: ' + item.id)
    if (hasString(item.id)) ids.add(item.id)
    if (previousId && hasString(item.id) && previousId.localeCompare(item.id) > 0) {
      errors.push('items must be sorted by id: ' + previousId + ' before ' + item.id)
    }
    if (hasString(item.id)) previousId = item.id
    if (!hasString(item.type)) errors.push('items[' + index + '].type must be a non-empty string')
    else counts[item.type] = (counts[item.type] ?? 0) + 1
    if (!hasString(item.source?.path)) errors.push('items[' + index + '].source.path is required')
    if (!hasString(item.source?.repo_relative_path)) errors.push('items[' + index + '].source.repo_relative_path is required')
    if (!hasString(item.source?.locator)) errors.push('items[' + index + '].source.locator is required')
    if (typeof item.title !== 'string' && typeof item.search?.title !== 'string' && typeof item.search?.name !== 'string') {
      errors.push('items[' + index + '].title or search.title/search.name is required')
    }
    if (typeof item.text !== 'string' && typeof item.search?.body !== 'string' && typeof item.search?.summary !== 'string') {
      errors.push('items[' + index + '].text or search.body/search.summary is required')
    }
    if (!Array.isArray(item.tags)) errors.push('items[' + index + '].tags must be an array')
    if (!Array.isArray(item.concepts)) errors.push('items[' + index + '].concepts must be an array')
    if (!Array.isArray(item.relationships)) errors.push('items[' + index + '].relationships must be an array')
    if (!Array.isArray(item.provenance) || item.provenance.length === 0) {
      errors.push('items[' + index + '].provenance must be a non-empty array')
    }
    validateOptionalRichMetadata(item, index, errors)
    validateProvenanceItems(item, index, errors)
    forbidV2FieldsOnV1Record(item, index, errors)
    if (!item.privacy || typeof item.privacy.pii !== 'boolean' || !hasString(item.privacy.classification)) {
      errors.push('items[' + index + '].privacy requires classification and pii')
    } else if (!isPrivacyClassification(item.privacy.classification)) {
      errors.push('items[' + index + '].privacy.classification must be one of private, sanitized, public')
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
  if (data?.source_export_schema_version !== undefined && !isSupportedIndexSchemaVersion(data.source_export_schema_version)) {
    errors.push('source_export_schema_version must be aiwg.fortemi.index.export.v1 or aiwg.fortemi.index.export.v2 when present')
  }
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
    if (!isSupportedRecordSchemaVersion(item.schema_version)) {
      errors.push('items[' + index + '].schema_version must be aiwg.fortemi.index.record.v1 or aiwg.fortemi.index.record.v2')
    }
    if (!hasString(item.id)) errors.push('items[' + index + '].id is required')
    if (hasString(item.id) && ids.has(item.id)) errors.push('duplicate id: ' + item.id)
    if (hasString(item.id)) ids.add(item.id)
    if (previousId && hasString(item.id) && previousId.localeCompare(item.id) > 0) {
      errors.push('items must be sorted by id: ' + previousId + ' before ' + item.id)
    }
    if (hasString(item.id)) previousId = item.id
    if (!hasString(item.type)) errors.push('items[' + index + '].type must be a non-empty string')
    if (typeof item.title !== 'string' && typeof item.search?.title !== 'string' && typeof item.search?.name !== 'string') {
      errors.push('items[' + index + '].title or search.title/search.name is required')
    }
    if (typeof item.text !== 'string' && typeof item.search?.body !== 'string' && typeof item.search?.summary !== 'string') {
      errors.push('items[' + index + '].text or search.body/search.summary is required')
    }
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
        schema_version: manifest?.source_export_schema_version ?? 'aiwg.fortemi.index.export.v1',
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

// Schemes an index fetch may target. Blocks file:, ftp:, ws:, etc. so a
// manifest-controlled href cannot pivot the browser into a non-web protocol.
const ALLOWED_AIWG_FETCH_SCHEMES = new Set(['http:', 'https:', 'blob:', 'data:'])

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

// Resolve and vet a manifest-controlled fetch target (SEC2 — SSRF).
// - With a baseUrl: the href is resolved against it and MUST stay same-origin,
//   so an absolute `href` (which `new URL` would otherwise honor, ignoring the
//   base) cannot redirect the fetch to an attacker origin.
// - Without a baseUrl: the caller opted into a bare href; only the scheme is
//   vetted (relative hrefs are passed through unchanged).
export function resolveAiwgFetchUrl(href: string, baseUrl?: string | URL): string {
  if (baseUrl === undefined) {
    const absolute = tryParseUrl(href)
    if (absolute && !ALLOWED_AIWG_FETCH_SCHEMES.has(absolute.protocol)) {
      throw new Error('Refusing AIWG index fetch with disallowed scheme: ' + absolute.protocol)
    }
    return href
  }
  const base = new URL(baseUrl)
  const resolved = new URL(href, base)
  if (!ALLOWED_AIWG_FETCH_SCHEMES.has(resolved.protocol)) {
    throw new Error('Refusing AIWG index fetch with disallowed scheme: ' + resolved.protocol)
  }
  if (resolved.origin !== base.origin) {
    throw new Error('Refusing cross-origin AIWG index fetch: ' + resolved.origin + ' != ' + base.origin)
  }
  return resolved.toString()
}

export function createAiwgFetchChunkLoader(baseUrl?: string | URL): AiwgChunkedIndexLoader {
  return async (part) => {
    const href = resolveAiwgFetchUrl(part.href, baseUrl)
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
    const href = resolveAiwgFetchUrl(relative, baseUrl)
    const response = await fetch(href)
    if (!response.ok) throw new Error('Failed to fetch AIWG index detail ' + href + ': ' + response.status)
    return response.json()
  }
}

export function getAiwgFortemiFacets(items: AiwgFortemiRecord[]): Record<string, Record<string, number>> {
  // Null-prototype accumulator: untrusted facet names must never resolve to an
  // inherited property (see pushFacet / SEC1 / #236). Round-trips to a plain
  // object through JSON serialization, so no downstream consumer is affected.
  const result: Record<string, Record<string, number>> = Object.create(null)
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

function recordTitle(item: AiwgFortemiProjectedRecord): string {
  return item.title ?? item.search?.title ?? item.search?.name ?? item.id
}

function recordText(item: AiwgFortemiProjectedRecord): string {
  const base = item.text
    ?? item.search?.body
    ?? item.search?.summary
    ?? item.chunks?.map((chunk) => chunk.text ?? chunk.body ?? chunk.summary ?? '').filter(Boolean).join('\n')
    ?? ''
  const extractedText = 'binary_sources' in item
    ? item.binary_sources?.map((source) => source.extracted_text).filter(Boolean).join('\n') ?? ''
    : ''
  return [base, extractedText].filter(Boolean).join('\n')
}

function defaultEmbeddingInput(record: AiwgFortemiRecord, granularity: AiwgStaticEmbeddingSet['granularity']): string {
  const title = recordTitle(record)
  const text = recordText(record)
  if (granularity === 'title-summary') {
    const extractedText = record.binary_sources?.map((source) => source.extracted_text).filter(Boolean).join('\n') ?? ''
    return [title, record.search?.summary ?? '', extractedText].filter(Boolean).join('\n')
  }
  return [title, text].filter(Boolean).join('\n')
}

function generatedAtString(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString()
  return value ?? new Date().toISOString()
}

export async function buildAiwgStaticEmbeddingSet(
  index: AiwgFortemiIndexExport,
  options: BuildAiwgStaticEmbeddingSetOptions,
): Promise<AiwgStaticEmbeddingSet> {
  assertAiwgFortemiIndexExport(index)
  const granularity = options.granularity ?? 'body'
  // SEC6: default-safe privacy filter over the source records.
  const records = filterAiwgRecordsByPrivacy(options.records ?? index.items, options.privacy)
  const embeddings: AiwgStaticEmbeddingRecord[] = []

  for (const record of records) {
    const input = options.textForRecord?.(record) ?? defaultEmbeddingInput(record, granularity)
    const embedding = await options.backend.embed(input, record)
    if (embedding.length !== options.backend.dimensions) {
      throw new Error(`Embedding for ${record.id} has ${embedding.length} dimensions; expected ${options.backend.dimensions}`)
    }
    embeddings.push({
      record_id: record.id,
      embedding,
      granularity,
      input_hash: computeHash(new TextEncoder().encode(input)),
      source_path: record.source.path,
    })
  }

  const embeddingSet: AiwgStaticEmbeddingSet = {
    schema_version: 'aiwg.fortemi.embedding.set.v1',
    id: options.id,
    model: options.backend.model,
    dimensions: options.backend.dimensions,
    generated_at: generatedAtString(options.generatedAt),
    granularity,
    ...(options.metric ? { metric: options.metric } : {}),
    input_hash_algorithm: 'sha256',
    embeddings,
  }
  assertAiwgStaticEmbeddingSet(embeddingSet)
  return embeddingSet
}

function recordSearchValues(item: AiwgFortemiProjectedRecord): string[] {
  const search = item.search
  const values = [
    item.id,
    recordTitle(item),
    recordText(item),
    search?.title,
    search?.name,
    search?.summary,
    search?.body,
    search?.capability,
    search?.phase,
    search?.type,
    ...(search?.triggers ?? []),
    ...(search?.aliases ?? []),
    ...(search?.tags ?? []),
    ...(item.chunks ?? []).flatMap((chunk) => [chunk.text, chunk.body, chunk.summary, chunk.source_path]),
  ]
  if (search?.frontmatter) {
    for (const value of Object.values(search.frontmatter)) {
      if (typeof value === 'string') values.push(value)
      else if (Array.isArray(value)) values.push(...value.filter((entry): entry is string => typeof entry === 'string'))
    }
  }
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0)
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
  /** Privacy filtering (SEC6). Default-safe: excludes `private`/`pii` records. */
  privacy?: AiwgPrivacyFilterOptions
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
  // SEC6: default-safe privacy filter — `private`/`pii` records never enter the
  // generated scan parts, detail files, or manifest facet counts.
  const items = filterAiwgRecordsByPrivacy(index.items, options.privacy)
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
    source_export_schema_version: index.schema_version,
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
  const title = recordTitle(item)
  const text = recordText(item)
  if (title.toLowerCase().includes(q)) matches.push({ field: 'title', value: title })
  if (text.toLowerCase().includes(q)) matches.push({ field: 'text', value: text })
  for (const tag of item.tags) {
    if (tag.toLowerCase().includes(q)) matches.push({ field: 'tag', value: tag })
  }
  for (const concept of item.concepts) {
    if (concept.toLowerCase().includes(q)) matches.push({ field: 'concept', value: concept })
  }
  for (const value of recordSearchValues(item)) {
    if (value !== title && value !== text && value.toLowerCase().includes(q)) {
      matches.push({ field: 'text', value, score: DEFAULT_QUERY_WEIGHTS.text })
    }
  }
  return matches
}

const DISCOVERY_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on',
  'with', 'into', 'from', 'is', 'are', 'be', 'i', 'we', 'my',
  'it', 'you', 'me', 'us', 'your', 'our', 'this', 'that', 'these', 'those',
  'there', 'here', 'some', 'any', 'all', 'also', 'please', 'about',
  'how', 'what', 'which', 'where', 'when', 'who', 'why',
  'find', 'give', 'show', 'need', 'want', 'looking', 'look', 'help',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'handle', 'handles', 'handling',
  'aiwg', 'skill', 'skills', 'agent', 'agents', 'command', 'commands',
  'rule', 'rules', 'flow', 'flows', 'workflow', 'workflows',
])

function normalizeDiscoveryName(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
}

function discoveryTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 1 && !DISCOVERY_STOPWORDS.has(token))
}

function facetValues(item: AiwgFortemiRecord, names: string[]): string[] {
  return names.flatMap((name) => item.facets[name] ?? [])
}

function addDiscoveryMatch(matches: AiwgIndexQueryMatch[], match: AiwgIndexQueryMatch) {
  if (!matches.some((existing) => existing.field === match.field && existing.value === match.value && existing.reason === match.reason)) {
    matches.push(match)
  }
}

function damerauLevenshteinAtMostOne(left: string, right: string): boolean {
  if (left === right) return true
  if (Math.abs(left.length - right.length) > 1) return false

  if (left.length === right.length) {
    let firstDiff = -1
    let diffCount = 0
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        if (firstDiff < 0) firstDiff = index
        diffCount += 1
      }
    }
    if (diffCount === 1) return true
    return diffCount === 2
      && firstDiff + 1 < left.length
      && left[firstDiff] === right[firstDiff + 1]
      && left[firstDiff + 1] === right[firstDiff]
  }

  const shorter = left.length < right.length ? left : right
  const longer = left.length < right.length ? right : left
  let shorterIndex = 0
  let longerIndex = 0
  let edits = 0
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1
      longerIndex += 1
    } else {
      edits += 1
      if (edits > 1) return false
      longerIndex += 1
    }
  }
  return true
}

function nearDiscoveryNameMatch(query: string, name: string): boolean {
  const queryParts = normalizeDiscoveryName(query).split(/\s+/).filter(Boolean)
  const nameParts = normalizeDiscoveryName(name).split(/\s+/).filter(Boolean)
  if (queryParts.length !== nameParts.length) return false

  return queryParts.every((part, index) => {
    const target = nameParts[index]
    if (part === target) return true
    if (part.length < 5 || target.length < 5) return false
    return damerauLevenshteinAtMostOne(part, target)
  })
}

function lowerValues(values: string[]): string[] {
  return values.map((value) => value.toLowerCase())
}

interface DiscoveryScoringOptions {
  relaxOverlap?: boolean
}

function discoveryMatches(item: AiwgFortemiRecord, query: string, options: DiscoveryScoringOptions = {}): AiwgIndexQueryMatch[] {
  if (!query) return []
  const matches: AiwgIndexQueryMatch[] = []
  const tokens = discoveryTokens(query)
  const lower = tokens.length > 0 ? tokens.join(' ') : query.toLowerCase().trim()
  const rawLower = query.toLowerCase().trim()
  const idParts = item.id.split(/[:/]/)
  const names = [
    item.id,
    recordTitle(item),
    item.search?.name,
    item.search?.title,
    ...(item.search?.aliases ?? []),
    ...idParts,
    ...facetValues(item, ['name', 'canonical_name', 'command', 'skill', 'agent', 'rule']),
  ].filter((value): value is string => hasString(value))
  const triggers = [
    ...facetValues(item, ['trigger', 'triggers', 'trigger_phrase', 'trigger_phrases']),
    ...(item.search?.triggers ?? []),
  ]
  const capabilities = [
    ...facetValues(item, ['capability', 'capabilities', 'summary', 'description']),
    item.search?.capability,
    item.search?.summary,
    item.search?.phase,
    item.search?.type,
    ...(item.search?.tags ?? []),
    ...item.concepts,
    ...item.tags,
  ].filter((value): value is string => hasString(value))
  const sourceValues = [item.source?.path, item.source?.repo_relative_path, item.source?.locator].filter((value): value is string => hasString(value))
  const title = recordTitle(item)
  const summary = [item.search?.summary, recordText(item)].filter((value): value is string => hasString(value)).join('\n')
  const type = item.search?.type ?? item.type
  const tags = [...(item.search?.tags ?? []), ...item.tags]
  const useMultiToken = tokens.length > 1
  const minHits = useMultiToken ? (options.relaxOverlap ? 1 : Math.ceil(tokens.length / 2)) : 1
  const overlapOK = (hits: number): boolean => useMultiToken && hits >= minHits

  const addInfo = (match: AiwgIndexQueryMatch) => addDiscoveryMatch(matches, { ...match, score: 0 })
  const addScore = (score: number) => {
    if (score > 0) addDiscoveryMatch(matches, { field: 'id', value: item.id, score, reason: 'aiwg discovery score' })
  }

  for (const name of names) {
    if (normalizeDiscoveryName(query) === normalizeDiscoveryName(name)) {
      addInfo({ field: 'id', value: name, reason: 'exact canonical name' })
      addScore(1.001)
      return matches
    }
    if (nearDiscoveryNameMatch(query, name)) {
      addInfo({ field: 'id', value: name, reason: 'near canonical name' })
      addScore(0.951)
      return matches
    }
  }

  let score = 0
  const scoreText = (
    field: AiwgIndexQueryMatch['field'],
    value: string,
    reason: string,
    exactScore: number,
    overlapScore: number,
    weight: number,
    exactBonus = 0,
  ) => {
    const normalized = value.toLowerCase()
    if (normalized.includes(lower)) {
      score += exactScore * weight
      if (normalized === lower) score += exactBonus
      addInfo({ field, value, reason })
    } else if (useMultiToken) {
      const hits = tokens.filter((token) => normalized.includes(token)).length
      if (overlapOK(hits)) {
        score += overlapScore * weight * (hits / tokens.length)
        addInfo({ field, value, reason })
      }
    }
  }

  for (const trigger of lowerValues(triggers)) {
    if (trigger === lower || trigger === rawLower) {
      addInfo({ field: 'facet', value: trigger, reason: 'trigger phrase' })
      addScore(1.0008)
      return matches
    }
  }
  for (const trigger of triggers) {
    scoreText('facet', trigger, 'trigger phrase', 0.25, 0.06, 4)
  }
  for (const capability of capabilities) scoreText('concept', capability, 'capability overlap', 0.2, 0.1, 2)
  scoreText('title', title, 'title token overlap', 0.3, 0.08, 3, 0.2)
  for (const tag of tags) scoreText('tag', tag, 'tag token overlap', 0.2, 0.05, 2)
  if (summary) scoreText('text', summary, 'body token overlap', 0.15, 0.04, 1)
  for (const source of sourceValues) {
    scoreText('source', source, 'path overlap', 0.1, 0.03, 1)
  }
  if (type.toLowerCase().includes(lower)) {
    score += 0.1
    addInfo({ field: 'facet', value: type, reason: 'type overlap' })
  }
  addScore(Math.min(score, 1.0))

  return matches
}

function rankMatches(matches: AiwgIndexQueryMatch[], weights: AiwgIndexQueryWeights): number {
  return matches.reduce((total, match) => total + (match.score ?? weights[match.field]), 0)
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
  return clipSnippet(firstMatch?.value ?? recordText(item), q, maxLength)
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
  discoveryOptions: DiscoveryScoringOptions = {},
): AiwgRankedEntry[] {
  const weights = { ...DEFAULT_QUERY_WEIGHTS, ...options.weights }
  const profile = options.searchProfile ?? 'default'
  return items.map((item, ordinal) => ({
    item,
    ordinal: ordinalBase + ordinal,
    matches: profile === 'aiwg-discovery' ? discoveryMatches(item, q, discoveryOptions) : queryMatches(item, q),
  }))
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
  const entries = createRankedEntries(index.items, q, options)
  if (entries.length === 0 && q && options.searchProfile === 'aiwg-discovery') {
    return createQueryResultFromRankedEntries(createRankedEntries(index.items, q, options, 0, { relaxOverlap: true }), q, options)
  }
  return createQueryResultFromRankedEntries(entries, q, options)
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftMag = 0
  let rightMag = 0
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i]
    const r = right[i]
    dot += l * r
    leftMag += l * l
    rightMag += r * r
  }
  if (leftMag === 0 || rightMag === 0) return 0
  return dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag))
}

export function validateAiwgStaticEmbeddingSet(value: unknown): AiwgChunkedIndexValidationResult {
  const errors: string[] = []
  const data = value as Partial<AiwgStaticEmbeddingSet>
  if (data?.schema_version !== 'aiwg.fortemi.embedding.set.v1') errors.push('schema_version must be aiwg.fortemi.embedding.set.v1')
  if (!hasString(data?.id)) errors.push('id is required')
  if (!hasString(data?.model)) errors.push('model is required')
  if (!hasPositiveInteger(data?.dimensions)) errors.push('dimensions must be a positive integer')
  if (!hasString(data?.generated_at)) errors.push('generated_at is required')
  if (!hasString(data?.granularity)) errors.push('granularity is required')
  if (!Array.isArray(data?.embeddings)) errors.push('embeddings must be an array')
  for (const [index, embedding] of (data.embeddings ?? []).entries()) {
    if (!hasString(embedding.record_id)) errors.push('embeddings[' + index + '].record_id is required')
    if (!hasString(embedding.input_hash)) errors.push('embeddings[' + index + '].input_hash is required')
    if (!Array.isArray(embedding.embedding)) errors.push('embeddings[' + index + '].embedding must be an array')
    else if (hasPositiveInteger(data?.dimensions) && embedding.embedding.length !== data.dimensions) {
      errors.push('embeddings[' + index + '].embedding length must match dimensions')
    } else if (!embedding.embedding.every((number) => typeof number === 'number' && Number.isFinite(number))) {
      errors.push('embeddings[' + index + '].embedding must contain finite numbers')
    }
  }
  return { valid: errors.length === 0, errors }
}

export function assertAiwgStaticEmbeddingSet(value: unknown): AiwgStaticEmbeddingSet {
  const result = validateAiwgStaticEmbeddingSet(value)
  if (!result.valid) throw new Error('Invalid AIWG Fortemi embedding set:\n' + result.errors.join('\n'))
  return value as AiwgStaticEmbeddingSet
}

export function queryAiwgSemanticIndex(
  index: AiwgFortemiIndexExport,
  embeddingSet: AiwgStaticEmbeddingSet,
  queryEmbedding: number[],
  options: AiwgStaticSemanticQueryOptions = {},
): AiwgStaticSemanticResult[] {
  assertAiwgStaticEmbeddingSet(embeddingSet)
  if (queryEmbedding.length !== embeddingSet.dimensions) throw new Error('query embedding length must match embedding set dimensions')
  const byId = new Map(index.items.map((item) => [item.id, item]))
  const offset = options.offset ?? 0
  const limit = options.limit ?? 20
  return embeddingSet.embeddings
    .map((embedding): AiwgStaticSemanticResult | null => {
      const item = byId.get(embedding.record_id)
      if (!item) return null
      return { item, embedding, score: cosineSimilarity(queryEmbedding, embedding.embedding) }
    })
    .filter((result): result is AiwgStaticSemanticResult => result !== null && result.score >= (options.minScore ?? -1))
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(offset, offset + limit)
}

export function queryAiwgHybridIndex(
  index: AiwgFortemiIndexExport,
  embeddingSet: AiwgStaticEmbeddingSet,
  query: string,
  queryEmbedding: number[],
  options: AiwgStaticHybridQueryOptions = {},
): AiwgStaticSemanticResult[] {
  const lexicalOptions: AiwgStaticHybridQueryOptions = { ...options }
  delete lexicalOptions.limit
  delete lexicalOptions.offset
  const lexical = queryAiwgFortemiIndex(index, query, { ...lexicalOptions, rank: true })
  const semantic = queryAiwgSemanticIndex(index, embeddingSet, queryEmbedding, { limit: index.items.length })
  const lexicalWeight = options.lexicalWeight ?? 0.5
  const semanticWeight = options.semanticWeight ?? 0.5
  const lexicalScores = new Map(lexical.rankedItems?.map((entry) => [entry.item.id, entry.rank]) ?? [])
  const maxLexical = Math.max(1, ...lexicalScores.values())
  const embeddingById = new Map(semantic.flatMap((entry) => entry.embedding ? [[entry.item.id, entry.embedding] as const] : []))
  const semanticScores = new Map(semantic.map((entry) => [entry.item.id, entry.score]))
  const ids = new Set([...lexicalScores.keys(), ...semanticScores.keys()])
  const offset = options.offset ?? 0
  const limit = options.limit ?? 20
  return [...ids]
    .map((id) => {
      const item = index.items.find((candidate) => candidate.id === id)
      const embedding = embeddingById.get(id)
      if (!item) return null
      return {
        item,
        ...(embedding ? { embedding } : {}),
        score: ((lexicalScores.get(id) ?? 0) / maxLexical) * lexicalWeight + (semanticScores.get(id) ?? 0) * semanticWeight,
      }
    })
    .filter((result): result is AiwgStaticSemanticResult => result !== null && result.score >= (options.minScore ?? -1))
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(offset, offset + limit)
}

// Default cap for the pairwise duplicate scan. The scan is O(n²) in the number
// of embeddings, so an unbounded attacker-supplied set is a CPU DoS (SEC5). At
// the default of 5000 the worst case is ~12.5M cosine comparisons; callers with
// a trusted, larger set can raise the cap explicitly.
export const DEFAULT_AIWG_DUPLICATE_SCAN_MAX_EMBEDDINGS = 5000

export function findAiwgStaticDuplicatePairs(
  index: AiwgFortemiIndexExport,
  embeddingSet: AiwgStaticEmbeddingSet,
  threshold = 0.9,
  options?: { maxEmbeddings?: number },
): AiwgStaticDuplicatePair[] {
  assertAiwgStaticEmbeddingSet(embeddingSet)
  const maxEmbeddings = options?.maxEmbeddings ?? DEFAULT_AIWG_DUPLICATE_SCAN_MAX_EMBEDDINGS
  if (embeddingSet.embeddings.length > maxEmbeddings) {
    throw new Error(
      'Embedding set too large for duplicate scan: ' + embeddingSet.embeddings.length +
        ' > ' + maxEmbeddings + ' (raise options.maxEmbeddings to override for trusted input)',
    )
  }
  const byId = new Map(index.items.map((item) => [item.id, item]))
  const pairs: AiwgStaticDuplicatePair[] = []
  for (let leftIndex = 0; leftIndex < embeddingSet.embeddings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < embeddingSet.embeddings.length; rightIndex += 1) {
      const leftEmbedding = embeddingSet.embeddings[leftIndex]
      const rightEmbedding = embeddingSet.embeddings[rightIndex]
      const left = byId.get(leftEmbedding.record_id)
      const right = byId.get(rightEmbedding.record_id)
      if (!left || !right) continue
      const score = cosineSimilarity(leftEmbedding.embedding, rightEmbedding.embedding)
      if (score >= threshold) pairs.push({ left, right, score })
    }
  }
  return pairs.sort((left, right) => right.score - left.score || left.left.id.localeCompare(right.left.id))
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
    searchProfile: options.searchProfile ?? 'default',
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

function relationshipTypeFilter(options?: AiwgRelationshipQueryOptions): string | undefined {
  return options?.relationshipType ?? options?.type
}

function edgeFromRelationship(sourceId: string, relationship: AiwgFortemiRelationship): AiwgRelationshipEdgeSummary {
  return {
    source_id: sourceId,
    target_id: relationship.target_id,
    type: relationship.type,
    ...(relationship.source_path ? { source_path: relationship.source_path } : {}),
    ...(relationship.target_path ? { target_path: relationship.target_path } : {}),
    ...(relationship.direction ? { direction: relationship.direction } : {}),
  }
}

function relationshipMatches(edge: AiwgRelationshipEdgeSummary, options: AiwgRelationshipQueryOptions = {}): boolean {
  const type = relationshipTypeFilter(options)
  const direction = options.direction ?? 'both'
  if (type && edge.type !== type) return false
  if (options.relationshipDirection && edge.direction !== options.relationshipDirection) return false
  if (options.sourceId && edge.source_id !== options.sourceId) return false
  if (options.targetId && edge.target_id !== options.targetId) return false
  if (options.endpointId && edge.source_id !== options.endpointId && edge.target_id !== options.endpointId) return false
  if (direction === 'out' && options.targetId && edge.target_id !== options.targetId) return false
  if (direction === 'in' && options.sourceId && edge.source_id !== options.sourceId) return false
  return true
}

function nodeSummary(item: AiwgFortemiProjectedRecord): AiwgRelationshipNodeSummary {
  return { id: item.id, type: item.type, title: recordTitle(item) }
}

function addNode(nodes: Map<string, AiwgRelationshipNodeSummary>, item: AiwgFortemiProjectedRecord | undefined) {
  if (item) nodes.set(item.id, nodeSummary(item))
}

function relationshipResultFromRecords(
  records: AiwgFortemiProjectedRecord[],
  options: AiwgRelationshipQueryOptions = {},
): AiwgRelationshipTraversalResult {
  const byId = new Map(records.map((record) => [record.id, record]))
  const edges: AiwgRelationshipEdgeSummary[] = []
  for (const record of records) {
    for (const relationship of record.relationships ?? []) {
      const edge = edgeFromRelationship(record.id, relationship)
      if (!relationshipMatches(edge, options)) continue
      edges.push(edge)
    }
  }
  const sortedEdges = edges.sort((left, right) => (
    left.source_id.localeCompare(right.source_id)
    || left.target_id.localeCompare(right.target_id)
    || left.type.localeCompare(right.type)
  ))
  const limitedEdges = options.limit ? sortedEdges.slice(0, options.limit) : sortedEdges
  const nodes = new Map<string, AiwgRelationshipNodeSummary>()
  for (const edge of limitedEdges) {
    addNode(nodes, byId.get(edge.source_id))
    addNode(nodes, byId.get(edge.target_id))
  }
  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: limitedEdges,
    complete: true,
  }
}

function neighborQueryOptions(id: string, options: AiwgRelationshipTraversalOptions = {}): AiwgRelationshipQueryOptions {
  const direction = options.direction ?? 'both'
  return {
    ...options,
    ...(direction === 'out' ? { sourceId: id } : {}),
    ...(direction === 'in' ? { targetId: id } : {}),
    ...(direction === 'both' ? { endpointId: id } : {}),
  }
}

function filterNeighborResult(id: string, result: AiwgRelationshipTraversalResult, options: AiwgRelationshipTraversalOptions = {}): AiwgRelationshipTraversalResult {
  const direction = options.direction ?? 'both'
  const edges = result.edges.filter((edge) => {
    if (direction === 'out') return edge.source_id === id
    if (direction === 'in') return edge.target_id === id
    return edge.source_id === id || edge.target_id === id
  })
  const ids = new Set<string>()
  for (const edge of edges) {
    ids.add(edge.source_id)
    ids.add(edge.target_id)
  }
  return {
    ...result,
    edges,
    nodes: result.nodes.filter((node) => ids.has(node.id)),
  }
}

async function recordsFromChunkedRuntime(
  runtime: AiwgChunkedIndexRuntime,
  onProgress?: (progress: AiwgChunkedIndexProgress) => void,
): Promise<{ records: AiwgFortemiRecord[]; scannedParts: number; fetchedParts: number }> {
  let scannedParts = 0
  let fetchedParts = 0
  const records: AiwgFortemiRecord[] = []
  for (const partRef of runtime.manifest.parts) {
    const loaded = await loadChunkPart(runtime, partRef)
    if (loaded.fetched) fetchedParts += 1
    scannedParts += 1
    onProgress?.({ phase: 'part', done: scannedParts, total: runtime.manifest.parts.length, href: partRef.href })
    for (const item of loaded.part.items) {
      records.push(item.relationships ? item : await getChunkRecord(runtime, item.id))
    }
  }
  return { records, scannedParts, fetchedParts }
}

async function relationshipResultFromChunkedRuntime(
  runtime: AiwgChunkedIndexRuntime,
  options: AiwgRelationshipQueryOptions = {},
): Promise<AiwgRelationshipTraversalResult> {
  const loaded = await recordsFromChunkedRuntime(runtime)
  return {
    ...relationshipResultFromRecords(loaded.records, options),
    scannedParts: loaded.scannedParts,
    fetchedParts: loaded.fetchedParts,
  }
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
    async neighbors(id: string, options?: AiwgRelationshipTraversalOptions): Promise<AiwgRelationshipTraversalResult> {
      try {
        const queryOptions = neighborQueryOptions(id, options)
        const result = chunked
          ? await relationshipResultFromChunkedRuntime(chunked, queryOptions)
          : relationshipResultFromRecords(requireIndex().items, queryOptions)
        return filterNeighborResult(id, result, options)
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err))
        notify()
        throw error
      }
    },
    async relationshipQuery(options?: AiwgRelationshipQueryOptions): Promise<AiwgRelationshipTraversalResult> {
      try {
        return chunked
          ? await relationshipResultFromChunkedRuntime(chunked, options)
          : relationshipResultFromRecords(requireIndex().items, options)
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err))
        notify()
        throw error
      }
    },
    async relationshipSet(options: AiwgRelationshipSetOptions): Promise<AiwgRelationshipSetResult> {
      const [left, right] = await Promise.all([
        this.neighbors(options.a, options),
        this.neighbors(options.b, options),
      ])
      const leftIds = new Set(left.nodes.map((node) => node.id).filter((id) => id !== options.a))
      const rightIds = new Set(right.nodes.map((node) => node.id).filter((id) => id !== options.b))
      let ids: string[]
      if (options.op === 'intersection') ids = [...leftIds].filter((id) => rightIds.has(id))
      else if (options.op === 'difference') ids = [...leftIds].filter((id) => !rightIds.has(id))
      else ids = [...new Set([...leftIds, ...rightIds])]
      return { op: options.op, ids: ids.sort() }
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
    async toCommunityGraphChunked(options?: AiwgIndexGraphOptions & { onProgress?: (progress: AiwgChunkedIndexProgress) => void }) {
      if (!chunked) return aiwgFortemiIndexToCommunityGraph(requireIndex(), options)
      const loaded = await recordsFromChunkedRuntime(chunked, options?.onProgress)
      return aiwgFortemiIndexToCommunityGraph({
        schema_version: 'aiwg.fortemi.index.export.v1',
        generated_at: chunked.manifest.generated_at,
        source: chunked.manifest.source,
        items: loaded.records,
      }, options)
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
        index ??
        (chunked
          ? { schema_version: chunked.manifest.source_export_schema_version ?? 'aiwg.fortemi.index.export.v1' }
          : null)
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
