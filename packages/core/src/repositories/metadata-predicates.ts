import type { SearchOptions } from './types.js'

export const REGISTERED_METADATA_PATHS = [
  'provider',
  'model',
  'role',
  'event_kind',
  'sensitivity',
  'import_run_id',
] as const

export type RegisteredMetadataPath = typeof REGISTERED_METADATA_PATHS[number]

export type MetadataPredicate =
  | { path: RegisteredMetadataPath; op: 'eq'; value: string | number | boolean | null }
  | { path: RegisteredMetadataPath; op: 'in'; value: readonly (string | number | boolean | null)[] }
  | { path: RegisteredMetadataPath; op: 'range'; gte?: string | number; lte?: string | number }
  | { path: RegisteredMetadataPath; op: 'exists'; value?: boolean }

export interface EvidenceLocator {
  note_id: string
  chunk?: { kind: 'current' | 'title' | 'attachment'; index: number }
  span?: { start: number; end: number }
  source?: {
    namespace: string
    external_id_hash: string
    import_run_id: string
    schema_version: string
  }
  metadata_paths: RegisteredMetadataPath[]
}

export interface MetadataPredicateConditionResult {
  conditions: string[]
  joins: string[]
  params: unknown[]
  nextIdx: number
}

const REGISTERED_SET = new Set<string>(REGISTERED_METADATA_PATHS)
const MAX_PREDICATES = 8
const MAX_IN_VALUES = 32
const MAX_VALUE_LENGTH = 256

function assertRegisteredPath(path: string): asserts path is RegisteredMetadataPath {
  if (!REGISTERED_SET.has(path) || path.includes('.') || path.includes('/')) {
    throw new Error(`Unsupported metadata predicate path: ${path}`)
  }
}

function assertBoundedValue(value: unknown): void {
  if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
    throw new Error('Metadata predicate value exceeds the 256 character bound')
  }
}

function jsonAccessor(path: RegisteredMetadataPath): string {
  if (path === 'import_run_id') return 'si.import_run_id'
  return `c.ai_metadata ->> '${path}'`
}

export function buildMetadataPredicateConditions(
  options: Pick<SearchOptions, 'metadataPredicates' | 'tenant_id' | 'archive_id'>,
  startIdx: number,
): MetadataPredicateConditionResult {
  const predicates = options.metadataPredicates ?? []
  if (predicates.length > MAX_PREDICATES) {
    throw new Error(`Metadata predicate count exceeds the ${MAX_PREDICATES} predicate bound`)
  }

  const conditions: string[] = []
  const params: unknown[] = []
  const joins: string[] = []
  let idx = startIdx
  let needsSourceJoin = options.tenant_id !== undefined || options.archive_id !== undefined

  if (options.tenant_id !== undefined) {
    conditions.push(`COALESCE(si.tenant_id, 'default') = $${idx++}`)
    params.push(options.tenant_id)
  }
  if (options.archive_id !== undefined) {
    conditions.push(`si.archive_id IS NOT DISTINCT FROM $${idx++}`)
    params.push(options.archive_id)
  }

  for (const predicate of predicates) {
    assertRegisteredPath(predicate.path)
    const lhs = jsonAccessor(predicate.path)
    if (predicate.path === 'import_run_id') needsSourceJoin = true

    if (predicate.op === 'eq') {
      assertBoundedValue(predicate.value)
      conditions.push(`${lhs} IS NOT DISTINCT FROM $${idx++}`)
      params.push(predicate.value == null ? null : String(predicate.value))
    } else if (predicate.op === 'in') {
      if (predicate.value.length > MAX_IN_VALUES) {
        throw new Error(`Metadata predicate membership exceeds the ${MAX_IN_VALUES} value bound`)
      }
      for (const value of predicate.value) assertBoundedValue(value)
      conditions.push(`${lhs} = ANY($${idx++})`)
      params.push(predicate.value.map((value) => value == null ? null : String(value)))
    } else if (predicate.op === 'range') {
      if (predicate.gte === undefined && predicate.lte === undefined) {
        throw new Error('Metadata range predicate requires gte or lte')
      }
      if (predicate.gte !== undefined) {
        assertBoundedValue(predicate.gte)
        conditions.push(`${lhs} >= $${idx++}`)
        params.push(String(predicate.gte))
      }
      if (predicate.lte !== undefined) {
        assertBoundedValue(predicate.lte)
        conditions.push(`${lhs} <= $${idx++}`)
        params.push(String(predicate.lte))
      }
    } else {
      conditions.push(predicate.value === false ? `${lhs} IS NULL` : `${lhs} IS NOT NULL`)
    }
  }

  if (needsSourceJoin) {
    joins.push('LEFT JOIN source_identity si ON si.note_id = n.id')
  }

  return { conditions, joins, params, nextIdx: idx }
}
