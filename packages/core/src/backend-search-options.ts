import type { BackendSearchQueryOptions } from './data-backend.js'
import { validateMetadataPredicates } from './repositories/metadata-predicates.js'

/** Local operation gates, not a negotiated server contract or authorization. */
export function validateBackendSearchOptions(
  options: BackendSearchQueryOptions | undefined,
  support: { metadata: boolean; scope: boolean; modes?: readonly string[] },
): void {
  if (options?.metadataPredicates !== undefined) {
    validateMetadataPredicates(options.metadataPredicates)
    if (!support.metadata) throw new Error('BACKEND_METADATA_PREDICATES_UNSUPPORTED')
  }
  if (options?.tenant_id !== undefined || options?.archive_id !== undefined) {
    if (!support.scope) throw new Error('BACKEND_SEARCH_SCOPE_UNSUPPORTED')
    if ((options.tenant_id !== undefined && (typeof options.tenant_id !== 'string' || !options.tenant_id.length))
      || (options.archive_id !== undefined && options.archive_id !== null
        && (typeof options.archive_id !== 'string' || !options.archive_id.length))) {
      throw new Error('BACKEND_SEARCH_SCOPE_INVALID')
    }
  }
  if (options?.mode !== undefined && support.modes && !support.modes.includes(options.mode)) {
    throw new Error('BACKEND_SEARCH_MODE_UNSUPPORTED')
  }
}
