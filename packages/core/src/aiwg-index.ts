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

export interface AiwgIndexValidationResult {
  valid: boolean
  errors: string[]
  counts: Partial<Record<AiwgFortemiRecordType, number>>
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
  data: AiwgIndexQueryResult | null
  error: Error | null
  reviewDecisions: AiwgReviewDecision[]
}

export type AiwgIndexControllerListener = (snapshot: AiwgIndexControllerSnapshot) => void

export interface AiwgIndexController {
  loadIndex(value: unknown): AiwgFortemiIndexExport
  getIndex(): AiwgFortemiIndexExport | null
  getSnapshot(): AiwgIndexControllerSnapshot
  query(query?: string, options?: AiwgIndexQueryOptions): AiwgIndexQueryResult
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

export function queryAiwgFortemiIndex(
  index: AiwgFortemiIndexExport,
  query = '',
  options: AiwgIndexQueryOptions = {},
): AiwgIndexQueryResult {
  const q = query.trim().toLowerCase()
  const weights = { ...DEFAULT_QUERY_WEIGHTS, ...options.weights }
  const matched = index.items.map((item, ordinal) => ({ item, ordinal, matches: queryMatches(item, q) }))
  const filtered = matched.filter(({ item, matches }) => {
    if (q && matches.length === 0) return false
    if (options.types && !options.types.includes(item.type)) return false
    if (options.privacy && !options.privacy.includes(item.privacy.classification)) return false
    if (!includesAll(item.tags, options.tags)) return false
    if (!includesAll(item.concepts, options.concepts)) return false
    if (!matchesFacetFilters(item, options.facets)) return false
    if (options.relationshipTargetId && !item.relationships.some((rel) => rel.target_id === options.relationshipTargetId)) return false
    return true
  })
  const ranked = filtered.map(({ item, ordinal, matches }) => ({
    item,
    ordinal,
    rank: rankMatches(matches, weights),
    matches,
  }))

  if (options.rank) {
    ranked.sort((left, right) => (
      right.rank - left.rank
      || left.ordinal - right.ordinal
    ))
  } else {
    ranked.sort((left, right) => left.ordinal - right.ordinal)
  }

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
      ...(options.snippets ? { snippet: createSnippet(entry.item, entry.matches, q, snippetLength) } : {}),
      ...(options.includeMatches ? { matches: entry.matches } : {}),
    }))
  }
  return result
}

export function createAiwgReviewDecisionExport(
  source: AiwgFortemiIndexExport,
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
  let data: AiwgIndexQueryResult | null = null
  let error: Error | null = null
  let reviewDecisions: AiwgReviewDecision[] = []
  const listeners = new Set<AiwgIndexControllerListener>()

  const snapshot = (): AiwgIndexControllerSnapshot => ({
    index,
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
      return createAiwgReviewDecisionExport(requireIndex(), reviewDecisions, generatedAt)
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
