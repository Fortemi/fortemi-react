export type AiwgFortemiRecordType =
  | 'crm.contact'
  | 'crm.organization'
  | 'crm.event'
  | 'crm.interaction'
  | 'aiwg.artifact'

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
}

export interface AiwgIndexQueryResult {
  items: AiwgFortemiRecord[]
  total: number
  facets: Record<string, Record<string, number>>
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
])

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

export function queryAiwgFortemiIndex(
  index: AiwgFortemiIndexExport,
  query = '',
  options: AiwgIndexQueryOptions = {},
): AiwgIndexQueryResult {
  const q = query.trim().toLowerCase()
  const filtered = index.items.filter((item) => {
    if (q) {
      const haystack = [item.title, item.text, ...item.tags, ...item.concepts].join('\n').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (options.types && !options.types.includes(item.type)) return false
    if (options.privacy && !options.privacy.includes(item.privacy.classification)) return false
    if (!includesAll(item.tags, options.tags)) return false
    if (!includesAll(item.concepts, options.concepts)) return false
    if (!matchesFacetFilters(item, options.facets)) return false
    if (options.relationshipTargetId && !item.relationships.some((rel) => rel.target_id === options.relationshipTargetId)) return false
    return true
  })

  const offset = options.offset ?? 0
  const limit = options.limit ?? filtered.length
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    facets: getAiwgFortemiFacets(filtered),
  }
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
