import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  allMigrations,
  createPGliteInstance,
  exportFullV1Snapshot,
  importFullV1Snapshot,
  MemoryBlobStore,
  MigrationRunner,
  NotesRepository,
  packTarGz,
  unpackTarGz,
} from '../../index.js'

const archive = new Uint8Array(readFileSync(new URL(
  './fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url,
)))
const encoder = new TextEncoder()

describe('public full-v1 archival operations (#424, not native restore)', () => {
  it('exposes byte-preserving archival operations independently of native state', async () => {
    const db = await createPGliteInstance('memory', 'archival-public')
    try {
      await new MigrationRunner(db).apply(allMigrations)
      const blobs = new MemoryBlobStore()
      const notes = new NotesRepository(db)
      const native = await notes.create({ title: 'Native', content: 'Native content outside archive' })
      const imported = await importFullV1Snapshot(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })
      expect(imported.success, imported.errors.join('; ')).toBe(true)
      expect(imported.counts.notes).toBe(0)
      expect(imported.component_counts?.notes).toBe(2)
      expect((await notes.get(native.id)).original.content).toBe('Native content outside archive')
      expect((await db.query('SELECT count(*)::int AS n FROM note')).rows).toEqual([{ n: 1 }])
      await notes.update(native.id, { content: 'Updated native content' })
      const exported = await exportFullV1Snapshot(db, blobs)
      expect(exported.success, exported.errors.join('; ')).toBe(true)
      expect(unpackTarGz(exported.archive!)).toEqual(unpackTarGz(archive))
      const skipped = await importFullV1Snapshot(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })
      expect(skipped.success).toBe(true)
      const conflict = await importFullV1Snapshot(db, archive, { blobStore: blobs, conflictStrategy: 'error' })
      expect(conflict.success).toBe(false)
      expect((await notes.get(native.id)).current.content).toBe('Updated native content')
    } finally { await db.close() }
  }, 30_000)

  it.each([
    ['invalid gzip', new Uint8Array([1, 2, 3])],
    ['missing manifest', packTarGz(new Map())],
    ...['null', '[]', '{', '{"version":"2.0.0","profile":"full-v1","components":{}}']
      .map((text) => [`invalid manifest ${text}`, packTarGz(new Map([['manifest.json', encoder.encode(text)]]))]),
  ])('rejects %s with a report before touching storage', async (_label, bytes) => {
    const result = await importFullV1Snapshot({
      query: async () => { throw new Error('Unexpected query') },
      transaction: async () => { throw new Error('Unexpected transaction') },
      exec: async () => { throw new Error('Unexpected exec') },
    }, bytes as Uint8Array)
    expect(result.success).toBe(false)
    expect(result.counts.notes).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
