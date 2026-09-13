import type { QueryExecutor } from '../storage-backend.js'
import { hexToBytes } from '@noble/hashes/utils'
import { MAX_EVIDENCE_BYTES, parseSearchEvidenceLocator, resolveSearchEvidence } from '../search-evidence.js'
import type { SearchOptions } from './types.js'
import { buildNoteConditions } from './condition-builder.js'
import { buildMetadataPredicateConditions, buildMetadataSourceConditions } from './metadata-predicates.js'

/** Local selection only. Hosted callers must supply their own authorized database context. */
export type SearchEvidenceScope = Pick<SearchOptions, 'tenant_id' | 'archive_id' | 'visibility' | 'metadataPredicates'>

function validateScope(scope: SearchEvidenceScope): void {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(scope))
    || Object.keys(scope).some(key => !['tenant_id', 'archive_id', 'visibility', 'metadataPredicates'].includes(key))) {
    throw new Error('SEARCH_EVIDENCE_INVALID')
  }
  for (const key of ['tenant_id', 'archive_id', 'visibility'] as const) {
    const value = scope[key]
    if (value === undefined || (key === 'archive_id' && value === null)) continue
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
      || Array.from(value).some(char => {
        const code = char.codePointAt(0)!
        return code >= 0xd800 && code <= 0xdfff
      })) throw new Error('SEARCH_EVIDENCE_INVALID')
  }
}

/** Resolve exact current storage, never a locator-authorized historical lookup. */
export async function resolveStoredSearchEvidence(
  db: QueryExecutor,
  value: unknown,
  scope: SearchEvidenceScope = {},
): Promise<string> {
  const locator = parseSearchEvidenceLocator(value)
  validateScope(scope)
  const options: SearchEvidenceScope = { ...scope, tenant_id: scope.tenant_id ?? 'default' }
  const notes = buildNoteConditions(options, 5)
  const metadata = buildMetadataPredicateConditions(options, notes.nextIdx)
  const params: unknown[] = [locator.note_id, locator.unit.id, locator.unit.index, MAX_EVIDENCE_BYTES,
    ...notes.params, ...metadata.params]
  const conditions = ['n.id = $1', ...notes.conditions, ...metadata.conditions]
  let joins: string
  let content: string
  switch (locator.unit.kind) {
    case 'current':
      joins = 'JOIN note_revised_current c ON c.note_id = n.id'
      content = 'c.content'
      conditions.push('n.id = $2', '$3::integer = 0')
      break
    case 'title':
      joins = ''
      content = 'n.title'
      conditions.push('n.id = $2', '$3::integer = 0')
      break
    case 'embedding':
      joins = 'JOIN embedding e ON e.note_id = n.id'
      content = 'e.text'
      conditions.push('e.id = $2', 'e.chunk_index = $3')
      break
    case 'attachment':
      joins = 'JOIN attachment a ON a.note_id = n.id'
      content = 'a.extracted_text'
      conditions.push('a.id = $2', '$3::integer = 0', "a.status = 'completed'", 'a.deleted_at IS NULL')
      break
  }
  if (locator.source) {
    const source = buildMetadataSourceConditions(options, metadata.nextIdx)
    let idx = source.nextIdx
    conditions.push(`EXISTS (SELECT 1 FROM source_identity si
      WHERE ${source.conditions.join(' AND ')}
        AND si.namespace = $${idx++} AND si.external_id_hash = $${idx++}
        AND si.import_run_id = $${idx++} AND si.source_schema_version = $${idx++})`)
    params.push(...source.params, locator.source.namespace, locator.source.external_id_hash,
      locator.source.import_run_id, locator.source.schema_version)
  }
  // Scope, unit and source are checked in the same statement snapshot. Oversized
  // raw text must not cross the database boundary, even to verify its digest.
  // Hex transport preserves a leading BOM that PGlite's text decoder removes.
  const result = await db.query<{ content_hex: string | null }>(
    `SELECT CASE WHEN octet_length(${content}) <= $4
       THEN encode(convert_to(${content}, 'UTF8'), 'hex') ELSE NULL END AS content_hex
     FROM note n ${joins} ${metadata.joins.join(' ')}
     WHERE ${conditions.join(' AND ')} LIMIT 1`, params,
  )
  const row = result.rows[0]
  return resolveSearchEvidence(locator, row?.content_hex == null ? null : {
    note_id: locator.note_id, unit: locator.unit,
    content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(hexToBytes(row.content_hex)),
    ...(locator.source === undefined ? {} : { source: locator.source }),
  })
}
