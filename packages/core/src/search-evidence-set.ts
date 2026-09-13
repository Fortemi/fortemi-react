import Ajv2020 from 'ajv/dist/2020.js'
import locatorSchema from '../schemas/metadata-search/candidate/1.0.0/evidence-locator.schema.json' with { type: 'json' }
import setSchema from '../schemas/metadata-search/candidate/1.0.0/evidence-set.schema.json' with { type: 'json' }
import { parseSearchEvidenceLocator, type SearchEvidenceLocator } from './search-evidence.js'

export const MAX_SEARCH_LOCATORS = 64
export const EVIDENCE_OMISSIONS = ['unavailable-unit', 'locator-limit'] as const
export type SearchEvidenceOmission = typeof EVIDENCE_OMISSIONS[number]
export interface SearchEvidenceSet {
  readonly version: '1.0.0'
  readonly locators: readonly SearchEvidenceLocator[]
  readonly omissions: readonly SearchEvidenceOmission[]
}
const validate = new Ajv2020({ strict: true, allErrors: false, ownProperties: true })
  .addSchema(locatorSchema).compile<SearchEvidenceSet>(setSchema)
const invalid = () => new Error('SEARCH_EVIDENCE_INVALID')
const priorities = { embedding: 0, title: 1, current: 2, attachment: 3 } as const

function scalarCompare(left: string, right: string): number {
  const a = Array.from(left, char => char.codePointAt(0)!)
  const b = Array.from(right, char => char.codePointAt(0)!)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}
function key(locator: SearchEvidenceLocator): (string | number)[] {
  return [priorities[locator.unit.kind], locator.unit.id, locator.unit.index, locator.content_digest,
    locator.span.start, locator.span.end, locator.source ? 1 : 0, locator.source?.namespace ?? '',
    locator.source?.external_id_hash ?? '', locator.source?.import_run_id ?? '', locator.source?.schema_version ?? '']
}
export function compareSearchEvidence(left: SearchEvidenceLocator, right: SearchEvidenceLocator): number {
  const a = key(left), b = key(right)
  for (let i = 0; i < a.length; i++) {
    const cmp = typeof a[i] === 'number' ? (a[i] as number) - (b[i] as number) : scalarCompare(a[i] as string, b[i] as string)
    if (cmp !== 0) return cmp
  }
  return 0
}

/** Validate canonical ordering and the enclosing hit's native note identity. */
export function parseSearchEvidenceSet(value: unknown, noteId: string): SearchEvidenceSet {
  if (!validate(value)) throw invalid()
  const locators = value.locators.map(parseSearchEvidenceLocator)
  if (locators.some((locator, i) => locator.note_id !== noteId || (i > 0 && compareSearchEvidence(locators[i - 1], locator) >= 0))) throw invalid()
  if (value.omissions.some((reason, i) => i > 0 && EVIDENCE_OMISSIONS.indexOf(value.omissions[i - 1]) >= EVIDENCE_OMISSIONS.indexOf(reason))) throw invalid()
  return Object.freeze({ version: '1.0.0', locators: Object.freeze(locators), omissions: Object.freeze([...value.omissions]) })
}

/** Bound and deduplicate already-projected locators; never fetch or invent text. */
export function createSearchEvidenceSet(
  noteId: string,
  values: readonly unknown[],
  omissions: readonly SearchEvidenceOmission[] = [],
): SearchEvidenceSet {
  const parsed = values.map(parseSearchEvidenceLocator)
  if (parsed.some(locator => locator.note_id !== noteId) || omissions.some(reason => !EVIDENCE_OMISSIONS.includes(reason))) throw invalid()
  const locators = parsed.sort(compareSearchEvidence)
    .filter((locator, i, all) => i === 0 || compareSearchEvidence(all[i - 1], locator) !== 0)
  const reasons = new Set(omissions)
  if (locators.length > MAX_SEARCH_LOCATORS) reasons.add('locator-limit')
  if (locators.length === 0) reasons.add('unavailable-unit')
  return parseSearchEvidenceSet({ version: '1.0.0', locators: locators.slice(0, MAX_SEARCH_LOCATORS),
    omissions: EVIDENCE_OMISSIONS.filter(reason => reasons.has(reason)) }, noteId)
}

/** Merge one hit's retrieval legs, retaining partial/unavailable provenance. */
export function mergeSearchEvidenceSets(noteId: string, sets: readonly SearchEvidenceSet[]): SearchEvidenceSet {
  const checked = sets.map(set => parseSearchEvidenceSet(set, noteId))
  return createSearchEvidenceSet(noteId, checked.flatMap(set => [...set.locators]), checked.flatMap(set => [...set.omissions]))
}
