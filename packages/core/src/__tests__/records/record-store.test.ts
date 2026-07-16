/**
 * RecordStore conformance — contract suite over both implementations plus
 * durability/journal semantics for the IndexedDB store (#323).
 * No PGlite anywhere in this file: this is the DB-free tier.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect } from 'vitest'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import { createRecordStore } from '../../records/idb-record-store.js'
import type { RecordStore, NoteRecord0 } from '../../records/index.js'

function noteRecord(id: string, title = `note ${id}`): NoteRecord0 {
  const ts = new Date().toISOString()
  return {
    id,
    archive_id: null,
    title,
    format: 'markdown',
    source: 'user',
    visibility: 'private',
    revision_mode: 'standard',
    is_starred: false,
    is_pinned: false,
    is_archived: false,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  }
}

function contractSuite(label: string, makeStore: () => Promise<RecordStore>) {
  describe(`${label} — contract`, () => {
    it('put/get round-trips a record', async () => {
      const store = await makeStore()
      await store.put('note', noteRecord('n1'))
      expect((await store.get('note', 'n1'))?.title).toBe('note n1')
      await store.close()
    })

    it('get returns null for unknown ids', async () => {
      const store = await makeStore()
      expect(await store.get('note', 'missing')).toBeNull()
      await store.close()
    })

    it('put replaces an existing record', async () => {
      const store = await makeStore()
      await store.put('note', noteRecord('n1', 'first'))
      await store.put('note', noteRecord('n1', 'second'))
      expect((await store.get('note', 'n1'))?.title).toBe('second')
      expect(await store.list('note')).toHaveLength(1)
      await store.close()
    })

    it('remove deletes the record', async () => {
      const store = await makeStore()
      await store.put('note', noteRecord('n1'))
      await store.remove('note', 'n1')
      expect(await store.get('note', 'n1')).toBeNull()
      await store.close()
    })

    it('list honors the limit option', async () => {
      const store = await makeStore()
      for (const id of ['a', 'b', 'c']) await store.put('note', noteRecord(id))
      expect(await store.list('note')).toHaveLength(3)
      expect(await store.list('note', { limit: 2 })).toHaveLength(2)
      await store.close()
    })

    it('journals every commit with monotonically increasing seq', async () => {
      const store = await makeStore()
      await store.put('note', noteRecord('n1'))
      await store.put('note_tag', {
        id: 't1',
        note_id: 'n1',
        tag: 'x',
        created_at: new Date().toISOString(),
      })
      await store.remove('note_tag', 't1')

      const entries = await store.journalSince(0)
      expect(entries.map((e) => e.op)).toEqual(['put', 'put', 'delete'])
      expect(entries.map((e) => e.collection)).toEqual(['note', 'note_tag', 'note_tag'])
      const seqs = entries.map((e) => e.seq)
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
      expect(await store.headSeq()).toBe(seqs[2])
      await store.close()
    })

    it('journalSince returns only entries after the cursor', async () => {
      const store = await makeStore()
      await store.put('note', noteRecord('n1'))
      const mid = await store.headSeq()
      await store.put('note', noteRecord('n2'))

      const tail = await store.journalSince(mid)
      expect(tail).toHaveLength(1)
      expect(tail[0].id).toBe('n2')
      expect(tail[0].record).toMatchObject({ id: 'n2' })
      await store.close()
    })

    it('reports its capability boundary explicitly', async () => {
      const store = await makeStore()
      expect(store.capabilities.crud).toBe(true)
      expect(store.capabilities.fullTextSearch).toBe(false)
      expect(store.capabilities.vectorSearch).toBe(false)
      await store.close()
    })
  })
}

contractSuite('MemoryRecordStore', async () => new MemoryRecordStore())
contractSuite('IdbRecordStore', () =>
  createRecordStore('contract', { indexedDB: new IDBFactory() }),
)

describe('IdbRecordStore durability', () => {
  it('records, journal, and head seq survive close/reopen', async () => {
    const factory = new IDBFactory()
    const first = await createRecordStore('durable', { indexedDB: factory })
    await first.put('note', noteRecord('n1'))
    await first.put('note', noteRecord('n2'))
    const head = await first.headSeq()
    await first.close()

    const second = await createRecordStore('durable', { indexedDB: factory })
    expect((await second.get('note', 'n1'))?.title).toBe('note n1')
    expect(await second.list('note')).toHaveLength(2)
    expect(await second.headSeq()).toBe(head)
    // New commits continue the sequence — no reuse after reload.
    const entry = await second.put('note', noteRecord('n3'))
    expect(entry.seq).toBeGreaterThan(head)
    await second.close()
  })

  it('namespaces are per-archive', async () => {
    const factory = new IDBFactory()
    const a = await createRecordStore('arch-a', { indexedDB: factory })
    const b = await createRecordStore('arch-b', { indexedDB: factory })
    await a.put('note', noteRecord('n1'))
    expect(await b.get('note', 'n1')).toBeNull()
    await a.close()
    await b.close()
  })

  it('refuses to open records written by a newer schema version', async () => {
    const factory = new IDBFactory()
    const store = await createRecordStore('newer', { indexedDB: factory })
    await store.close()

    // Simulate a future schema stamp.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('fortemi-newer-records')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite')
      tx.objectStore('meta').put(999, 'schemaVersion')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()

    await expect(createRecordStore('newer', { indexedDB: factory })).rejects.toThrow(
      /newer schema/,
    )
  })
})
