/** Presence semantics for Knowledge Shard schema 2.0 (Fortemi #1083). */

import fieldSemantics from '../../schemas/knowledge-shard/2.0.0/field-semantics.json' with { type: 'json' }
import type { KnowledgeShardProfile, ShardComponent, ShardLossEntry } from './types.js'

export type ShardPresenceState = 'absent' | 'null' | 'empty' | 'value'
export type StoredPresenceState = ShardPresenceState | 'legacy-indeterminate'
export type ShardPresenceMap = Record<string, StoredPresenceState>

interface InventoryField {
  profile: KnowledgeShardProfile
  component: string
  pointer: string
  required: boolean
  states: {
    absent: 'preserve' | 'reject'
    null: 'preserve' | 'reject'
    empty: Array<'empty-array' | 'empty-object' | 'empty-string'>
    value: 'preserve' | 'reject'
  }
}

const fields = fieldSemantics.fields as InventoryField[]

function decodePointerPart(part: string): string {
  return part.replaceAll('~1', '/').replaceAll('~0', '~')
}

function encodePointerPart(part: string): string {
  return part.replaceAll('~', '~0').replaceAll('/', '~1')
}

function pointerParts(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer '${pointer}'`)
  return pointer.slice(1).split('/').map(decodePointerPart)
}

function pointerFromParts(parts: readonly string[]): string {
  return `/${parts.map(encodePointerPart).join('/')}`
}

/**
 * Expand authority wildcards to the concrete array-member paths present in a
 * document. A wildcard over an empty or missing collection has no field
 * instances; structural schema validation owns the collection itself.
 */
export function concretePresencePointers(document: unknown, pointer: string): string[] {
  const parts = pointerParts(pointer)
  const visit = (value: unknown, index: number, concrete: string[]): string[] => {
    if (index === parts.length) return [pointerFromParts(concrete)]
    const part = parts[index]
    if (part === '*') {
      if (!Array.isArray(value)) return []
      return value.flatMap((item, itemIndex) => visit(item, index + 1, [
        ...concrete,
        String(itemIndex),
      ]))
    }
    const next = value && typeof value === 'object'
      ? (value as Record<string, unknown>)[part]
      : undefined
    return visit(next, index + 1, [...concrete, part])
  }
  return visit(document, 0, [])
}

function parentAndKey(
  document: unknown,
  pointer: string,
  required = true,
): { parent: Record<string, unknown>; key: string } | null {
  const parts = pointerParts(pointer)
  let parent: unknown = document
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') {
      if (!required) return null
      throw new Error(`JSON Pointer '${pointer}' does not resolve through an object`)
    }
    parent = (parent as Record<string, unknown>)[part]
  }
  if (!parent || typeof parent !== 'object') {
    if (!required) return null
    throw new Error(`JSON Pointer '${pointer}' parent is not an object`)
  }
  return { parent: parent as Record<string, unknown>, key: parts.at(-1)! }
}

export function classifyPresenceValue(value: unknown): Exclude<ShardPresenceState, 'absent'> {
  if (value === null) return 'null'
  if (value === '' || (Array.isArray(value) && value.length === 0)) return 'empty'
  if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) return 'empty'
  return 'value'
}

export function classifyOwnProperty(document: unknown, pointer: string): ShardPresenceState {
  const resolved = parentAndKey(document, pointer, false)
  if (!resolved) return 'absent'
  const { parent, key } = resolved
  return Object.hasOwn(parent, key) ? classifyPresenceValue(parent[key]) : 'absent'
}

export function capturePresence(document: unknown, pointers: readonly string[]): ShardPresenceMap {
  return Object.fromEntries(pointers.flatMap((pointer) =>
    concretePresencePointers(document, pointer)
      .map((concrete) => [concrete, classifyOwnProperty(document, concrete)]),
  ))
}

export function presencePointers(
  profile: KnowledgeShardProfile,
  component: ShardComponent | 'manifest' | 'signature',
): string[] {
  return fields
    .filter((field) => field.profile === profile && field.component === component)
    .map((field) => field.pointer)
}

function emptyKind(value: unknown): 'empty-array' | 'empty-object' | 'empty-string' | null {
  if (value === '') return 'empty-string'
  if (Array.isArray(value) && value.length === 0) return 'empty-array'
  if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) return 'empty-object'
  return null
}

export function presenceLosses(
  profile: KnowledgeShardProfile,
  component: ShardComponent | 'manifest' | 'signature',
  record: Record<string, unknown>,
  recordId?: string,
): ShardLossEntry[] {
  return fields.flatMap((field) => {
    if (field.profile !== profile || field.component !== component) return []
    return concretePresencePointers(record, field.pointer).flatMap((pointer) => {
      const state = classifyOwnProperty(record, pointer)
      const supported = state === 'absent'
        ? field.states.absent === 'preserve'
        : state === 'null'
          ? field.states.null === 'preserve'
          : state === 'value'
            ? field.states.value === 'preserve'
            : (() => {
                const resolved = parentAndKey(record, pointer, false)
                return resolved
                  ? field.states.empty.includes(emptyKind(resolved.parent[resolved.key])!)
                  : false
              })()
      if (supported) return []
      return [{
        code: 'unsupported-presence-state',
        message: `${component}${recordId ? ` ${recordId}` : ''} ${pointer} does not support ${state}`,
        component: component === 'manifest' || component === 'signature' ? undefined : component,
        record_id: recordId,
        field_path: pointer,
        source_state: state,
        action: 'reject',
        reason: 'authority-field-semantics',
      }]
    })
  })
}

export function componentPresenceLosses(
  profile: KnowledgeShardProfile,
  component: ShardComponent,
  records: readonly Record<string, unknown>[],
): ShardLossEntry[] {
  return records.flatMap((record, index) => presenceLosses(
    profile,
    component,
    record,
    typeof record.id === 'string' ? record.id : String(index),
  ))
}

export function assertStoredPresence(
  document: Record<string, unknown>,
  presence: ShardPresenceMap,
): void {
  for (const [pointer, stored] of Object.entries(presence)) {
    if (stored === 'legacy-indeterminate') continue
    const actual = classifyOwnProperty(document, pointer)
    if (actual !== stored) {
      throw new Error(`Presence metadata mismatch at ${pointer}: stored=${stored}, actual=${actual}`)
    }
  }
}

export function restoreStoredPresence<T extends Record<string, unknown>>(
  document: T,
  presence: ShardPresenceMap,
): T {
  const restored = structuredClone(document)
  for (const [pointer, stored] of Object.entries(presence)) {
    const resolved = parentAndKey(restored, pointer)
    if (!resolved) throw new Error(`JSON Pointer '${pointer}' parent is not an object`)
    const { parent, key } = resolved
    if (stored === 'legacy-indeterminate') {
      throw new Error(`Cannot emit schema 2.0 with legacy-indeterminate state at ${pointer}`)
    }
    if (stored === 'absent') {
      delete parent[key]
    } else if (stored === 'null') {
      parent[key] = null
    } else if (classifyOwnProperty(restored, pointer) !== stored) {
      throw new Error(`Stored ${stored} state at ${pointer} does not match the persisted value`)
    }
  }
  return restored
}
