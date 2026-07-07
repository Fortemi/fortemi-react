/**
 * SPIKE #238 — minimal working proof for a shard↔server conformance harness.
 *
 * Proves the recommended approach (committed shard JSON Schema as the structural
 * authority) is CI-runnable with no live server and would catch the S1-S9 field
 * breaks the audit found — the existing `format-parity` suite cannot, because it
 * validates PGlite table shapes, not the shard JSON contract.
 *
 * This uses a compact JSON-Schema-subset checker so the proof stays zero-dep. The
 * full implementation should swap in AJV against the same committed schema (and
 * add golden fixtures from a real server) — see
 * .aiwg/spikes/238-shard-conformance-harness.md.
 */
import { describe, expect, it } from 'vitest'
import type { ShardNote } from '../../shard/types.js'
import schema from '../../../schemas/knowledge-shard.schema.json' with { type: 'json' }

type JsonSchema = Record<string, unknown>
const defs = (schema as JsonSchema).$defs as Record<string, JsonSchema>

function resolveRef(ref: string): JsonSchema {
  const name = ref.replace('#/$defs/', '')
  return defs[name]
}

function typeMatches(type: unknown, value: unknown): boolean {
  const types = Array.isArray(type) ? type : [type]
  return types.some((t) => {
    switch (t) {
      case 'string':
        return typeof value === 'string'
      case 'boolean':
        return typeof value === 'boolean'
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value)
      case 'array':
        return Array.isArray(value)
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value)
      case 'null':
        return value === null
      default:
        return true
    }
  })
}

/** Returns [] when `value` conforms to `node`, else a list of path-qualified errors. */
function validate(node: JsonSchema, value: unknown, path = ''): string[] {
  if (typeof node.$ref === 'string') return validate(resolveRef(node.$ref), value, path)
  const errors: string[] = []
  if ('const' in node && value !== node.const) errors.push(`${path || '(root)'} must equal ${JSON.stringify(node.const)}`)
  if (Array.isArray(node.enum) && !node.enum.includes(value)) errors.push(`${path} is not an allowed enum value`)
  if (node.type !== undefined && !typeMatches(node.type, value)) {
    errors.push(`${path || '(root)'} must be type ${JSON.stringify(node.type)}`)
    return errors
  }
  if (typeof node.pattern === 'string' && typeof value === 'string' && !new RegExp(node.pattern).test(value)) {
    errors.push(`${path} does not match /${node.pattern}/`)
  }
  if (typeMatches('object', value)) {
    const obj = value as Record<string, unknown>
    const properties = (node.properties as Record<string, JsonSchema>) ?? {}
    for (const req of (node.required as string[]) ?? []) {
      if (!(req in obj)) errors.push(`${path}.${req} is required`)
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not an allowed property`)
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (key in obj) errors.push(...validate(sub, obj[key], `${path}.${key}`))
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      for (const [key, entry] of Object.entries(obj)) {
        errors.push(...validate(node.additionalProperties as JsonSchema, entry, `${path}.${key}`))
      }
    }
  }
  if (typeMatches('array', value) && node.items) {
    for (const [i, entry] of (value as unknown[]).entries()) {
      errors.push(...validate(node.items as JsonSchema, entry, `${path}[${i}]`))
    }
  }
  return errors
}

const conformantNote: ShardNote = {
  id: 'note-1',
  title: 'Example',
  original_content: 'hello',
  revised_content: null,
  format: 'markdown',
  source: 'manual',
  starred: false,
  archived: false,
  tags: ['a'],
  created_at: '2026-07-07T00:00:00.000Z',
  updated_at: '2026-07-07T00:00:00.000Z',
  deleted_at: null,
}

describe('#238 spike — shard conformance schema (minimal proof)', () => {
  it('accepts a conformant server-contract note', () => {
    expect(validate(defs.note, conformantNote)).toEqual([])
  })

  it('S-class: rejects a renamed field (server contract drift)', () => {
    // A generator that emits `content` instead of `original_content` — the exact
    // class of break format-parity misses.
    const { original_content, ...rest } = conformantNote
    const drifted = { ...rest, content: original_content }
    const errors = validate(defs.note, drifted)
    expect(errors.join('\n')).toContain('.original_content is required')
    expect(errors.join('\n')).toContain('.content is not an allowed property')
  })

  it('S-class: rejects a missing required field and a wrong type', () => {
    const noStarred: Partial<ShardNote> = { ...conformantNote }
    delete noStarred.starred
    expect(validate(defs.note, noStarred).join('\n')).toContain('.starred is required')
    expect(validate(defs.note, { ...conformantNote, starred: 'yes' }).join('\n')).toContain('.starred must be type "boolean"')
  })

  it('accepts a conformant manifest and rejects a malformed checksum', () => {
    const manifest = {
      version: '1.0.0',
      matric_version: '1.0.0',
      format: 'matric-shard',
      created_at: '2026-07-07T00:00:00.000Z',
      components: ['notes'],
      counts: { notes: 1 },
      checksums: { 'notes.jsonl': 'a'.repeat(64) },
      min_reader_version: '1.0.0',
    }
    expect(validate(defs.manifest, manifest)).toEqual([])
    expect(validate(defs.manifest, { ...manifest, format: 'zip' }).join('\n')).toContain('format must equal "matric-shard"')
    expect(validate(defs.manifest, { ...manifest, checksums: { 'notes.jsonl': 'nothex' } }).join('\n')).toContain('does not match')
  })
})
