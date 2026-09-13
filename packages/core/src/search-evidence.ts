import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../schemas/metadata-search/candidate/1.0.0/evidence-locator.schema.json' with { type: 'json' }
import { computeHash } from './hash.js'

export const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024
export interface EvidenceTextUnit {
  readonly kind: 'current' | 'title' | 'embedding' | 'attachment'
  readonly id: string
  readonly index: number
}
export interface EvidenceSourceIdentity {
  readonly namespace: string
  readonly external_id_hash: string
  readonly import_run_id: string
  readonly schema_version: string
}
export interface SearchEvidenceLocator {
  readonly version: '1.0.0'
  readonly note_id: string
  readonly unit: EvidenceTextUnit
  readonly content_digest: string
  readonly span: { readonly unit: 'utf8-bytes'; readonly start: number; readonly end: number }
  readonly source?: EvidenceSourceIdentity
}
/** The caller supplies already-authorized text, not an access grant from this type. */
export interface EvidenceTextSnapshot {
  readonly note_id: string
  readonly unit: EvidenceTextUnit
  readonly content: string
  readonly source?: EvidenceSourceIdentity
}

const validateSchema = new Ajv2020({ strict: true, allErrors: false, ownProperties: true }).compile<SearchEvidenceLocator>(schema)
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const invalid = () => new Error('SEARCH_EVIDENCE_INVALID')
const unavailable = () => new Error('SEARCH_EVIDENCE_UNAVAILABLE')
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

/** Parse an untrusted wire value, taking an immutable validated copy. */
export function parseSearchEvidenceLocator(value: unknown): SearchEvidenceLocator {
  if (!validateSchema(value)) throw invalid()
  const locator = value
  const strings = [locator.note_id, locator.unit.id, ...Object.values(locator.source ?? {})]
  if (!strings.every(wellFormed) || locator.span.start > locator.span.end) throw invalid()
  if ((locator.unit.kind === 'current' || locator.unit.kind === 'title') && locator.unit.id !== locator.note_id) throw invalid()
  const copy: SearchEvidenceLocator = {
    version: locator.version, note_id: locator.note_id,
    unit: Object.freeze({ kind: locator.unit.kind, id: locator.unit.id, index: locator.unit.index }),
    content_digest: locator.content_digest,
    span: Object.freeze({ unit: locator.span.unit, start: locator.span.start, end: locator.span.end }),
    ...(locator.source === undefined ? {} : { source: Object.freeze({ ...locator.source }) }),
  }
  return Object.freeze(copy)
}

function textBytes(content: string): Uint8Array | null {
  if (typeof content !== 'string' || content.length > MAX_EVIDENCE_BYTES || !wellFormed(content)) return null
  const bytes = encoder.encode(content)
  return bytes.length <= MAX_EVIDENCE_BYTES ? bytes : null
}

function spanText(bytes: Uint8Array, start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > bytes.length) return null
  // An empty range inside a multibyte code point must still be rejected.
  if ((start < bytes.length && (bytes[start] & 0xc0) === 0x80)
    || (end < bytes.length && (bytes[end] & 0xc0) === 0x80)) return null
  try { return decoder.decode(bytes.subarray(start, end)) } catch { return null }
}

/** Bind exact raw text. No Unicode normalization, trimming or HTML processing. */
export function bindSearchEvidence(text: EvidenceTextSnapshot, start: number, end: number): SearchEvidenceLocator {
  const bytes = textBytes(text.content)
  if (!bytes || spanText(bytes, start, end) === null) throw invalid()
  return parseSearchEvidenceLocator({ version: '1.0.0', note_id: text.note_id, unit: text.unit,
    content_digest: computeHash(bytes), span: { unit: 'utf8-bytes', start, end },
    ...(text.source === undefined ? {} : { source: text.source }),
  })
}

function sameSource(a: EvidenceSourceIdentity | undefined, b: EvidenceSourceIdentity | undefined): boolean {
  if (!a || !b) return a === b
  return a.namespace === b.namespace && a.external_id_hash === b.external_id_hash
    && a.import_run_id === b.import_run_id && a.schema_version === b.schema_version
}

/** Pure binding check over already-authorized text; never performs database I/O. */
export function resolveSearchEvidence(value: unknown, text: EvidenceTextSnapshot | null): string {
  const locator = parseSearchEvidenceLocator(value)
  if (!text || locator.note_id !== text.note_id || locator.unit.kind !== text.unit.kind
    || locator.unit.id !== text.unit.id || locator.unit.index !== text.unit.index
    || !sameSource(locator.source, text.source)) throw unavailable()
  const bytes = textBytes(text.content)
  if (!bytes || computeHash(bytes) !== locator.content_digest) throw unavailable()
  const result = spanText(bytes, locator.span.start, locator.span.end)
  if (result === null) throw unavailable()
  return result
}
