import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../schemas/metadata-search/candidate/1.0.0/predicates.schema.json' with { type: 'json' }
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

const validateSchema = new Ajv2020({ strict: true, allErrors: false, ownProperties: true }).compile(schema)

function compareStrings(left: string, right: string): number {
  const a = Array.from(left, char => char.codePointAt(0)!)
  const b = Array.from(right, char => char.codePointAt(0)!)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

export function validateMetadataPredicates(value: unknown): asserts value is readonly MetadataPredicate[] {
  if (!validateSchema(value)) throw new Error('METADATA_PREDICATES_INVALID')
  const predicates = value as readonly MetadataPredicate[]
  for (const predicate of predicates) {
    // JavaScript permits lone surrogates; PostgreSQL and the Rust JSON parser do not.
    const values = predicate.op === 'range' ? [predicate.gte, predicate.lte]
      : predicate.op === 'in' ? predicate.value : [predicate.value]
    for (const scalar of values) {
      if (typeof scalar === 'string' && Array.from(scalar).some(char => {
        const code = char.codePointAt(0)!
        return code >= 0xd800 && code <= 0xdfff
      })) throw new Error('METADATA_PREDICATES_INVALID')
    }
  }
  for (const predicate of predicates) {
    if (predicate.op !== 'range' || predicate.gte === undefined || predicate.lte === undefined) continue
    const reversed = typeof predicate.gte === 'string'
      ? compareStrings(predicate.gte, predicate.lte as string) > 0
      : predicate.gte > (predicate.lte as number)
    if (reversed) throw new Error('METADATA_RANGE_INVALID')
  }
}

type ScopeOptions = Pick<SearchOptions, 'metadataPredicates' | 'tenant_id' | 'archive_id'>
type Scalar = string | number | boolean | null

function predicateSql(predicate: MetadataPredicate, compare: (value: Scalar, op: '=' | '>=' | '<=') => string, exists: string): string {
  switch (predicate.op) {
    case 'eq': return compare(predicate.value, '=')
    case 'in': return predicate.value.length ? `(${predicate.value.map(value => compare(value, '=')).join(' OR ')})` : 'FALSE'
    case 'range': return `(${[
      predicate.gte === undefined ? null : compare(predicate.gte, '>='),
      predicate.lte === undefined ? null : compare(predicate.lte, '<='),
    ].filter(Boolean).join(' AND ')})`
    case 'exists': return predicate.value === false ? `NOT (${exists})` : exists
  }
}

// This is a local source-identity scope, never a grant of tenant authorization.
export function buildMetadataSourceConditions(options: ScopeOptions, startIdx: number): MetadataPredicateConditionResult {
  const predicates = options.metadataPredicates === undefined ? [] : options.metadataPredicates
  validateMetadataPredicates(predicates)
  const params: unknown[] = [options.tenant_id ?? 'default']
  let idx = startIdx + 1
  const conditions = [`si.note_id = n.id`, `si.tenant_id = $${startIdx}`,
    'si.archive_id IS NOT DISTINCT FROM n.archive_id', 'si.import_run_id IS NOT NULL']
  for (const predicate of predicates.filter(p => p.path === 'import_run_id')) {
    conditions.push(predicateSql(predicate, (value, op) => {
      params.push(value)
      return `si.import_run_id COLLATE "C" ${op} $${idx++}::text COLLATE "C"`
    }, 'si.import_run_id IS NOT NULL'))
  }
  return { conditions, joins: [], params, nextIdx: idx }
}

export function buildMetadataPredicateConditions(
  options: ScopeOptions,
  startIdx: number,
): MetadataPredicateConditionResult {
  const predicates = options.metadataPredicates === undefined ? [] : options.metadataPredicates
  validateMetadataPredicates(predicates)
  const conditions: string[] = []
  const params: unknown[] = []
  const joins: string[] = []
  let idx = startIdx
  if (options.archive_id !== undefined) {
    conditions.push(`n.archive_id IS NOT DISTINCT FROM $${idx++}::text`)
    params.push(options.archive_id)
  }
  if (options.tenant_id !== undefined) {
    const source = buildMetadataSourceConditions({ ...options, metadataPredicates: [] }, idx)
    const native = options.tenant_id === 'default'
      ? ' OR NOT EXISTS (SELECT 1 FROM source_identity si WHERE si.note_id = n.id)' : ''
    conditions.push(`(EXISTS (SELECT 1 FROM source_identity si WHERE ${source.conditions.join(' AND ')})${native})`)
    params.push(...source.params)
    idx = source.nextIdx
  }
  for (const predicate of predicates) {
    if (predicate.path === 'import_run_id') continue
    const lhs = `(n.metadata -> '${predicate.path}')`
    conditions.push(predicateSql(predicate, (value, op) => {
      if (value === null) return `jsonb_typeof(${lhs}) = 'null'`
      const rhs = `$${idx++}::jsonb`
      params.push(JSON.stringify(value))
      const type = typeof value
      if (type === 'string') {
        return `(jsonb_typeof(${lhs}) = 'string'
          AND public.metadata_search_order_key_v1(${lhs}) IS NULL
          AND public.metadata_search_text_key_v1(${lhs}) COLLATE "C" ${op} public.metadata_search_text_key_v1(${rhs}) COLLATE "C"
          AND (${lhs} #>> '{}') COLLATE "C" ${op} (${rhs} #>> '{}') COLLATE "C")`
      }
      return `(jsonb_typeof(${lhs}) = '${type}'
        AND public.metadata_search_order_key_v1(${lhs}) ${op} public.metadata_search_order_key_v1(${rhs})
        AND ${lhs} ${op} ${rhs})`
    }, `jsonb_typeof(${lhs}) IS NOT NULL`))
  }
  const runs = predicates.filter(p => p.path === 'import_run_id')
  if (runs.length) {
    const positive = runs.filter(p => !(p.op === 'exists' && p.value === false))
    for (const [selected, negated] of [[positive, false], [[], true]] as const) {
      if (negated ? !runs.some(p => p.op === 'exists' && p.value === false) : !positive.length) continue
      const source = buildMetadataSourceConditions({ ...options, metadataPredicates: selected }, idx)
      conditions.push(`${negated ? 'NOT ' : ''}EXISTS (SELECT 1 FROM source_identity si WHERE ${source.conditions.join(' AND ')})`)
      params.push(...source.params)
      idx = source.nextIdx
    }
  }

  return { conditions, joins, params, nextIdx: idx }
}
