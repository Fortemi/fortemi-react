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

function pointerParts(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer '${pointer}'`)
  return pointer.slice(1).split('/').map(decodePointerPart)
}

function parentAndKey(document: unknown, pointer: string): { parent: Record<string, unknown>; key: string } {
  const parts = pointerParts(pointer)
  let parent: unknown = document
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
      throw new Error(`JSON Pointer '${pointer}' does not resolve through an object`)
    }
    parent = (parent as Record<string, unknown>)[part]
  }
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
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
  const { parent, key } = parentAndKey(document, pointer)
  return Object.hasOwn(parent, key) ? classifyPresenceValue(parent[key]) : 'absent'
}

export function capturePresence(document: unknown, pointers: readonly string[]): ShardPresenceMap {
  return Object.fromEntries(pointers.map((pointer) => [pointer, classifyOwnProperty(document, pointer)]))
}

export function presencePointers(
  profile: KnowledgeShardProfile,
  component: ShardComponent | 'manifest' | 'signature',
): string[] {
  return fields
    .filter((field) => field.profile === profile && field.component === component)
    .map((field) => field.pointer)
    .filter((pointer) => !pointer.includes('/*'))
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
    if (field.profile !== profile || field.component !== component || field.pointer.includes('/*')) return []
    const state = classifyOwnProperty(record, field.pointer)
    const supported = state === 'absent'
      ? field.states.absent === 'preserve'
      : state === 'null'
        ? field.states.null === 'preserve'
        : state === 'value'
          ? field.states.value === 'preserve'
          : field.states.empty.includes(emptyKind(parentAndKey(record, field.pointer).parent[parentAndKey(record, field.pointer).key])!)
    if (supported) return []
    return [{
      code: 'unsupported-presence-state',
      message: `${component}${recordId ? ` ${recordId}` : ''} ${field.pointer} does not support ${state}`,
      component: component === 'manifest' || component === 'signature' ? undefined : component,
      record_id: recordId,
      field_path: field.pointer,
      source_state: state,
      action: 'reject',
      reason: 'authority-field-semantics',
    }]
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
    const { parent, key } = parentAndKey(restored, pointer)
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
