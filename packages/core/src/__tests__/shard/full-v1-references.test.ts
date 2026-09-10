import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { MemoryBlobStore } from '../../blob-store.js'
import { importShard } from '../../shard/shard-import.js'
import { fullV1ReferenceErrors } from '../../shard/full-v1-references.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import {
  FULL_V1_COMPONENT_FILES,
  validateFullV1ShardArchive,
  validateShardComponentRecord,
} from '../../shard/schema-validator.js'
import type { ShardComponent, ShardManifest } from '../../shard/types.js'
import type { DatabaseClient } from '../../storage-backend.js'
import corpusJson from './fixtures/full-v1/reference-conformance.json'
import receipt from './fixtures/full-v1/reference-conformance.receipt.json'

type Row = Record<string, unknown>
type Change = { component: keyof typeof FULL_V1_COMPONENT_FILES; index?: number; copy?: number; fields: Row }
const corpus = corpusJson as { cases: { name: string; valid: boolean; changes: Change[] }[] }
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const archive = new Uint8Array(readFileSync(new URL(
  './fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url,
)))
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function mutate(changes: Change[]) {
  const files = unpackTarGz(archive)
  const records = new Map<ShardComponent, Row[]>()
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json'))) as ShardManifest
  for (const [component, spec] of Object.entries(FULL_V1_COMPONENT_FILES)) {
    const text = decoder.decode(files.get(spec.file))
    records.set(component as ShardComponent, spec.encoding === 'jsonl'
      ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : JSON.parse(text))
  }
  for (const change of changes) {
    const rows = records.get(change.component)!
    const index = change.copy === undefined ? change.index! : rows.push(structuredClone(rows[change.copy])) - 1
    Object.assign(rows[index], structuredClone(change.fields))
  }
  for (const [component, spec] of Object.entries(FULL_V1_COMPONENT_FILES)) {
    const rows = records.get(component as ShardComponent)!
    for (const row of rows) {
      const result = validateShardComponentRecord(component as ShardComponent, row, 'full-v1', '2.0.0')
      expect(result.valid, `${component}: ${result.errors.join('; ')}`).toBe(true)
    }
    const bytes = encoder.encode(spec.encoding === 'jsonl'
      ? rows.map((row) => `${JSON.stringify(row)}\n`).join('') : JSON.stringify(rows))
    files.set(spec.file, bytes)
    manifest.checksums[spec.file] = sha256(bytes)
    if (component === 'communities') {
      manifest.counts.community_sets = rows.length
      manifest.counts.communities = rows.reduce((n, row) => n + (row.communities as unknown[]).length, 0)
    } else {
      manifest.counts[component as keyof typeof manifest.counts] = rows.length
    }
  }
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
  return { files, records }
}

describe('producer-owned full-v1 relationship mutations (#424 prerequisite)', () => {
  it('binds the unchanged schema-2 adaptation used by these tests', () => {
    expect(sha256(archive)).toBe(receipt.consumer.archiveSha256)
    expect(sha256(readFileSync(new URL('./fixtures/full-v1/reference-conformance.json', import.meta.url))))
      .toBe(receipt.producer.sha256)
    expect(corpus.cases).toHaveLength(receipt.cases)
    expect(corpus.cases.filter((entry) => entry.valid)).toHaveLength(receipt.accepted)
    expect(corpus.cases.filter((entry) => !entry.valid)).toHaveLength(receipt.rejected)
  })

  it.each(corpus.cases)('$name', async (entry) => {
    const { files } = mutate(entry.changes)
    const result = await validateFullV1ShardArchive(files)
    expect(result.valid, result.errors.join('; ')).toBe(entry.valid)
    if (entry.valid) return
    // A schema/checksum/count error is not a relationship-rejection oracle.
    expect(result.errors.every((error) => /^[a-z_]+\[\d+\]: /.test(error))).toBe(true)
    const forbidden = vi.fn(async (): Promise<never> => { throw new Error('Unexpected storage access') })
    const db: DatabaseClient = { query: forbidden, exec: forbidden, transaction: forbidden }
    const blobs = new MemoryBlobStore()
    const put = vi.spyOn(blobs, 'put')
    const imported = await importShard(db, packTarGz(files), { blobStore: blobs, conflictStrategy: 'replace' })
    expect(imported.success).toBe(false)
    expect(imported.errors.join('; ')).toContain(result.errors[0])
    expect(forbidden).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })

  it('bounds diagnostics without including record contents', () => {
    const { records } = mutate([])
    records.set('notes', Array.from({ length: 200 }, () => ({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', collection_id: 'missing', original_content: 'PRIVATE-CONTENT',
    })))
    const errors = fullV1ReferenceErrors(records)
    expect(errors).toHaveLength(100)
    expect(errors.join('; ')).not.toContain('PRIVATE-CONTENT')
  })

  it.each(['null', '[]', '42', '"text"'])('rejects non-object manifest %s', async (text) => {
    const files = unpackTarGz(archive)
    files.set('manifest.json', encoder.encode(text))
    expect(await validateFullV1ShardArchive(files)).toEqual({ valid: false, errors: ['manifest.json must be an object'] })
  })
})
