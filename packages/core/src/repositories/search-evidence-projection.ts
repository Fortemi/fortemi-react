import { MAX_EVIDENCE_BYTES, type SearchEvidenceLocator } from '../search-evidence.js'
import { createSearchEvidenceSet, MAX_SEARCH_LOCATORS, type SearchEvidenceSet } from '../search-evidence-set.js'
import type { SearchOptions } from './types.js'
import { buildMetadataPredicateConditions, buildMetadataSourceConditions } from './metadata-predicates.js'

export interface ProjectedSearchEvidence {
  locators: (SearchEvidenceLocator | null)[]
  limited: boolean
}

/** Correlated with the ranking query's n/c/e aliases, not a later content read. */
export function buildSearchEvidenceProjection(
  options: SearchOptions,
  startIdx: number,
  match: { lexical?: { fn: 'phraseto_tsquery' | 'plainto_tsquery'; parameter: number }; embedding?: boolean },
): { sql: string; params: unknown[]; nextIdx: number } {
  const source = buildMetadataSourceConditions(options, startIdx)
  const scope = buildMetadataPredicateConditions({ tenant_id: options.tenant_id ?? 'default', archive_id: options.archive_id }, source.nextIdx)
  const units: string[] = []
  if (match.lexical) {
    const query = `${match.lexical.fn}('english', $${match.lexical.parameter})`
    units.push(`SELECT 1 AS priority, 'title'::text AS kind, n.id AS id, 0 AS index, n.title AS content
      WHERE to_tsvector('english', n.title) @@ ${query}`)
    units.push(`SELECT 2, 'current', n.id, 0, c.content
      WHERE to_tsvector('english', c.content) @@ ${query}`)
    units.push(`SELECT 3, 'attachment', a.id, 0, a.extracted_text FROM attachment a
      WHERE a.note_id = n.id AND a.deleted_at IS NULL AND a.status = 'completed'
        AND to_tsvector('english', a.extracted_text) @@ ${query}`)
  }
  if (match.embedding) units.push("SELECT 0, 'embedding'::text, e.id, e.chunk_index, NULLIF(e.text, '')")
  if (units.length === 0) throw new Error('SEARCH_EVIDENCE_INVALID')
  // Limit before hashing/serialization; the extra row records bounded loss.
  // JSON transports identities without PGlite's leading-BOM text decoding loss.
  return {
    params: [...source.params, ...scope.params], nextIdx: scope.nextIdx,
    sql: `(WITH units(priority, kind, id, index, content) AS (${units.join(' UNION ALL ')}),
      sources AS (
        SELECT DISTINCT si.namespace COLLATE "C" AS namespace, si.external_id_hash COLLATE "C" AS external_id_hash,
          si.import_run_id COLLATE "C" AS import_run_id, si.source_schema_version COLLATE "C" AS source_schema_version
        FROM source_identity si WHERE ${source.conditions.join(' AND ')}
        ORDER BY si.namespace COLLATE "C", si.external_id_hash COLLATE "C",
          si.import_run_id COLLATE "C", si.source_schema_version COLLATE "C"
        LIMIT ${MAX_SEARCH_LOCATORS + 1}
      ), candidates AS MATERIALIZED (
        SELECT u.*, s.namespace, s.external_id_hash, s.import_run_id, s.source_schema_version
        FROM units u LEFT JOIN sources s ON true
        ORDER BY u.priority, u.id COLLATE "C", u.index, s.namespace COLLATE "C",
          s.external_id_hash COLLATE "C", s.import_run_id COLLATE "C", s.source_schema_version COLLATE "C"
        LIMIT ${MAX_SEARCH_LOCATORS + 1}
      ), bound AS (
        SELECT CASE WHEN ${scope.conditions.join(' AND ')}
          AND char_length(n.id) BETWEEN 1 AND 200 AND char_length(id) BETWEEN 1 AND 200
          AND index BETWEEN 0 AND 2147483647 AND octet_length(content) <= ${MAX_EVIDENCE_BYTES}
          AND (namespace IS NULL OR (char_length(namespace) BETWEEN 1 AND 200
            AND external_id_hash ~ '^sha256:[a-f0-9]{64}$'
            AND char_length(import_run_id) BETWEEN 1 AND 200
            AND char_length(source_schema_version) BETWEEN 1 AND 200))
        THEN jsonb_build_object('version', '1.0.0', 'note_id', n.id,
          'unit', jsonb_build_object('kind', kind, 'id', id, 'index', index),
          'content_digest', 'sha256:' || encode(sha256(convert_to(content, 'UTF8')), 'hex'),
          'span', jsonb_build_object('unit', 'utf8-bytes', 'start', 0, 'end', octet_length(content)))
          || CASE WHEN namespace IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('source',
            jsonb_build_object('namespace', namespace, 'external_id_hash', external_id_hash,
              'import_run_id', import_run_id, 'schema_version', source_schema_version)) END
        ELSE NULL END AS locator FROM candidates
      ) SELECT jsonb_build_object('locators', coalesce(jsonb_agg(locator), '[]'::jsonb),
        'limited', count(*) > ${MAX_SEARCH_LOCATORS}) FROM bound)`,
  }
}

export function projectedSearchEvidence(noteId: string, value: ProjectedSearchEvidence): SearchEvidenceSet {
  return createSearchEvidenceSet(noteId, value.locators.filter(locator => locator !== null), [
    ...(value.locators.some(locator => locator === null) ? ['unavailable-unit' as const] : []),
    ...(value.limited ? ['locator-limit' as const] : []),
  ])
}
