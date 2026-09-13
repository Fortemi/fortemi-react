import Ajv2020 from 'ajv/dist/2020.js'
import { z } from 'zod'
import rest from '../schemas/metadata-search/candidate/1.0.0/search-rest.schema.json' with { type: 'json' }
import predicates from '../schemas/metadata-search/candidate/1.0.0/predicates.schema.json' with { type: 'json' }
import locator from '../schemas/metadata-search/candidate/1.0.0/evidence-locator.schema.json' with { type: 'json' }
import evidence from '../schemas/metadata-search/candidate/1.0.0/evidence-set.schema.json' with { type: 'json' }
import resolution from '../schemas/metadata-search/candidate/1.0.0/evidence-resolution.schema.json' with { type: 'json' }

const timestamp = z.string().datetime({ offset: true })
const ajv = new Ajv2020({ strict: true, allErrors: false, ownProperties: true })
  .addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .addFormat('date-time', { type: 'string', validate: (value: string) => timestamp.safeParse(value).success })
  .addKeyword({ keyword: 'x-fortemi-query-content', schemaType: 'string', valid: true })
  .addKeyword({ keyword: 'x-fortemi-max-encoded-utf8-bytes', schemaType: 'number', valid: true })
  .addSchema([rest, locator, evidence, resolution])
  // File-location aliases preserve the predicate schema's distinct canonical $id.
  .addSchema(predicates, new URL('predicates.schema.json', rest.$id).href)

// The adapter exposes only q/mode/limit/tags. Encoding annotations do not
// authorize additional query options; remoteSearchParameters enforces that subset.
export const isSearchRestRequest = ajv.compile({ $ref: rest.$id + '#/$defs/SearchRestRequest' })
export const isSearchRestResponse = ajv.compile({ $ref: rest.$id + '#/$defs/SearchRestResponse' })
export const isEvidenceResolveRequest = ajv.compile({ $ref: resolution.$id + '#/$defs/SearchEvidenceResolveRequest' })
export const isEvidenceResolveResponse = ajv.compile({ $ref: resolution.$id + '#/$defs/SearchEvidenceResolveResponse' })
