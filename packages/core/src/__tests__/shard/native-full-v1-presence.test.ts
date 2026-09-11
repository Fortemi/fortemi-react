import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { Geometry } from 'wkx'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import inventory from '../../../schemas/knowledge-shard/2.0.0/field-semantics.json' with { type: 'json' }
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { MemoryBlobStore } from '../../blob-store.js'
import { importShard } from '../../shard/shard-import.js'
import { exportShardWithReport } from '../../shard/shard-export.js'
import { FULL_V1_COMPONENT_FILES, validateFullV1ShardArchive } from '../../shard/schema-validator.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import { sha256Hex } from '../../shard/checksum.js'
import type { DatabaseClient } from '../../storage-backend.js'

type JsonObject = Record<string, unknown>
type Field = (typeof inventory.fields)[number]
type Component = keyof typeof FULL_V1_COMPONENT_FILES
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const source = unpackTarGz(new Uint8Array(readFileSync(new URL('./fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url))))

function readRecords(files: Map<string, Uint8Array>): Record<Component, JsonObject[]> {
  return Object.fromEntries(Object.entries(FULL_V1_COMPONENT_FILES).map(([component, spec]) => {
    const text = decoder.decode(files.get(spec.file))
    return [component, spec.encoding === 'json-array' ? JSON.parse(text) : text.split('\n').filter(Boolean).map((line) => JSON.parse(line))]
  })) as Record<Component, JsonObject[]>
}
const baseline = readRecords(source)
// Manifest producer/version describe the new export; lineage has a separate public matrix.
const fields = [...new Map(inventory.fields.filter((field) => field.profile !== 'record-v1' && field.component !== 'manifest')
  .map((field) => [`${field.component}${field.pointer}`, field])).values()]
const states = [
  { name: 'absent', value: undefined }, { name: 'null', value: null },
  { name: 'empty-string', value: '' }, { name: 'empty-array', value: [] }, { name: 'empty-object', value: {} },
  { name: 'value', value: undefined },
] as const

function parentAndKey(row: JsonObject, pointer: string): [JsonObject, string] {
  const parts = pointer.slice(1).split('/').map((part) => part === '*' ? '0' : part)
  let parent = row
  for (const part of parts.slice(0, -1)) parent = parent[part] as JsonObject
  if (parent === null || typeof parent !== 'object') throw new Error(`Missing fixture parent: ${pointer}`)
  return [parent, parts.at(-1)!]
}

function populated(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
    && (typeof value !== 'object' || Object.keys(value).length > 0)
}

function populatedValue(field: Field, records: Record<Component, JsonObject[]>): unknown {
  const path = `${field.component}${field.pointer}`
  const types: string[] = field.types
  if (field.pointer.endsWith('/owner_id')) return '018f4c11-9f14-7d33-8a21-1c80f648ffff'
  if (path === 'graph_sources/embedding_set_id') return records.embedding_sets[0].id
  if (path === 'provenance_records/attachment_id') return ((records.notes[0].attachments as JsonObject[])[0].attachment as JsonObject).id
  if (path === 'embedding_configs/provider') return 'custom'
  if (path === 'named_locations/country_code') return 'US'
  if (path === 'named_locations/boundary_ewkb_hex') return Geometry.parse('SRID=4326;POLYGON((0 0,1 0,1 1,0 1,0 0))').toEwkb().toString('hex')
  if (path === 'collections/parent_id') {
    const parent = { ...records.collections[0], id: '018f4c11-9f14-7d33-8a21-1c80f648fffe', name: 'Presence parent', parent_id: null, note_count: 0 }
    records.collections.push(parent)
    return parent.id
  }
  if (field.pointer.endsWith('/to_url') || field.pointer.endsWith('/source_url')) return 'https://example.org/native-presence'
  if (/(?:_at|\/lower|\/upper)$/.test(field.pointer)) return '2026-07-18T14:30:00.123456Z'
  if (types.includes('object')) return { native: [false, 0, '', null, {}, []], nested: { value: 'preserved' } }
  if (types.includes('boolean')) return true
  if (types.includes('integer')) return /truncate_dim$/.test(field.pointer) ? 768 : 16
  if (types.includes('number')) return 0.75
  if (types.includes('array')) {
    if (field.pointer === '/embedding') return Array.from({ length: 768 }, (_, index) => index === 0 ? 0.25 : 0)
    if (field.pointer === '/matryoshka_dims') return [768]
    if (field.pointer.endsWith('/representative_note_ids')) return [records.notes[0].id]
    return ['native-presence']
  }
  return 'Native presence value'
}

async function variant(field: Field, state: (typeof states)[number]) {
  const records = structuredClone(baseline)
  const rows = records[field.component as Component]
  const row = state.name === 'value' ? rows.find((row) => {
    const [parent, key] = parentAndKey(row, field.pointer)
    return populated(parent[key])
  }) ?? rows[0] : rows[0]
  const [parent, key] = parentAndKey(row, field.pointer)
  if (state.name === 'absent') delete parent[key]
  else if (state.name === 'value') {
    if (!populated(parent[key])) parent[key] = populatedValue(field, records)
    expect(populated(parent[key]), `${field.component}${field.pointer} populated fixture`).toBe(true)
    if (field.component === 'links' && key === 'to_url') row.to_note_id = null
    if (field.component === 'provenance_records' && /\/(lower|upper)$/.test(field.pointer)) {
      Object.assign(parent, { empty: false, lower: '2026-07-18T14:00:00Z', upper: '2026-07-18T15:00:00Z',
        lower_infinite: false, upper_infinite: false, lower_inclusive: true, upper_inclusive: false })
      parent[key] = '2026-07-18T14:30:00.123456Z'
    }
  }
  else parent[key] = structuredClone(state.value)
  // Keep alternative endpoints and range flags coherent for positive null cases.
  if (state.name === 'null') {
    if (field.component === 'links' && key === 'to_note_id') row.to_url = 'https://example.org/native-presence'
    if (field.component === 'provenance_records' && field.pointer === '/note_id') {
      row.attachment_id = ((records.notes[0].attachments as JsonObject[])[0].attachment as JsonObject).id
    }
    if (field.component === 'provenance_records' && /\/(lower|upper)$/.test(field.pointer) && !parent.empty) {
      parent[`${key}_infinite`] = true
      parent[`${key}_inclusive`] = false
    }
  }
  const files = new Map(source)
  const manifest = JSON.parse(decoder.decode(source.get('manifest.json')))
  for (const [component, spec] of Object.entries(FULL_V1_COMPONENT_FILES)) {
    const rows = records[component as Component]
    const bytes = encoder.encode(spec.encoding === 'json-array' ? JSON.stringify(rows) : rows.map((entry) => JSON.stringify(entry)).join('\n'))
    files.set(spec.file, bytes)
    manifest.checksums[spec.file] = await sha256Hex(bytes)
    manifest.counts[component] = component === 'communities' ? rows.reduce((sum, row) => sum + (row.communities as unknown[]).length, 0) : rows.length
  }
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
  files.delete('signature.json')
  return { files, records }
}

describe('authority inventory through public native full-v1 presence', () => {
  let pristine: Blob
  beforeAll(async () => {
    const db = await PGlite.create({ extensions: { vector } })
    try {
      await db.exec('CREATE EXTENSION vector')
      await new MigrationRunner(db).apply(allMigrations)
      pristine = await db.dumpDataDir('none')
    } finally { await db.close() }
  })

  for (const field of fields) for (const state of states) {
    it(`${field.component}${field.pointer}: ${state.name}`, async () => {
      const candidate = await variant(field, state)
      const validation = await validateFullV1ShardArchive(candidate.files)
      const allowed = state.name === 'absent' ? field.states.absent === 'preserve'
        : state.name === 'null' ? field.states.null === 'preserve'
          : state.name === 'value' ? field.states.value === 'preserve' : field.states.empty.includes(state.name)
      // The inventory's type-level empty-object entry is further constrained by range schemas.
      const constrainedEmpty = state.name === 'empty-object' && field.component === 'provenance_records'
        && ['/capture_time', '/original_capture_time'].includes(field.pointer)
      expect(validation.valid, JSON.stringify(validation.errors)).toBe(allowed && !constrainedEmpty)
      const archive = packTarGz(candidate.files)
      if (!validation.valid) {
        const access = vi.fn(() => { throw new Error('Unexpected database access') })
        const forbidden = new Proxy({} as DatabaseClient, { get: access })
        const blobs = new MemoryBlobStore()
        expect((await importShard(forbidden, archive, { blobStore: blobs })).success).toBe(false)
        expect(access).not.toHaveBeenCalled()
        expect((await blobs.reconcile([])).unreferenced).toEqual([])
        return
      }
      let incoming = archive
      // Each pass uses a genuinely clean database and blob store, not snapshot persistence.
      for (let pass = 0; pass < 2; pass++) {
        const db = await PGlite.create({ extensions: { vector }, loadDataDir: pristine })
        try {
          expect((await db.query('SELECT * FROM note')).rows).toEqual([])
          expect((await db.query('SELECT * FROM native_shard_record_lineage')).rows).toEqual([])
          const blobs = new MemoryBlobStore()
          const imported = await importShard(db, incoming, { blobStore: blobs, conflictStrategy: 'replace' })
          expect(imported.errors).toEqual([])
          expect(imported.success).toBe(true)
          const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
          expect(exported.errors, JSON.stringify(exported.errors)).toEqual([])
          expect(exported.success).toBe(true)
          expect((await validateFullV1ShardArchive(exported.archive!)).errors).toEqual([])
          const output = unpackTarGz(exported.archive!)
          const actual = readRecords(output)
          for (const [component, expected] of Object.entries(candidate.records)) {
            expect(actual[component as Component], `${component}, pass ${pass}`).toHaveLength(expected.length)
            expect(actual[component as Component], `${component}, pass ${pass}`).toEqual(expect.arrayContaining(expected))
          }
          for (const [path, bytes] of candidate.files) if (path.startsWith('blobs/')) expect(output.get(path), path).toEqual(bytes)
          expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
          expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
          incoming = exported.archive!
        } finally { await db.close() }
      }
    }, 30_000)
  }
})
