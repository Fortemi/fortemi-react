/**
 * Durable canonical RecordStore over IndexedDB (#323, ADR-013 D3).
 *
 * One database per archive namespace: `fortemi-<archive>-records`. Object
 * stores: one per record collection (keyPath `id`), plus `journal`
 * (autoIncrement `seq`) and `meta` (schema version).
 *
 * Recoverable commit protocol (ADR-013 D5): every mutation writes the record
 * change AND its journal entry in a single IndexedDB transaction, so a torn
 * write commits neither. The journal `seq` is the total order the optional
 * PGlite projection consumes.
 *
 * Schema evolution: `meta.schemaVersion` records the logical record-schema
 * version; `migrate` hooks run inside the version-change transaction when the
 * database structure grows. Additive-only, mirroring the SQL migration
 * discipline.
 */

import type {
  JournalEntry,
  RecordCollectionName,
  RecordCollections,
  RecordListOptions,
  RecordMutation,
  RecordStore,
  RecordStoreCapabilities,
} from './types.js'
import {
  normalizeRecordMutation,
  RECORD_COLLECTIONS,
  RECORD_STORE_CAPABILITIES,
} from './types.js'

const DB_VERSION = 1
const JOURNAL_STORE = 'journal'
const META_STORE = 'meta'
/** Logical record-schema version stored in `meta` (independent of DB_VERSION). */
export const RECORD_SCHEMA_VERSION = 2

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}

export interface CreateRecordStoreOptions {
  /** Injectable factory for tests (fake-indexeddb). Defaults to the global. */
  indexedDB?: IDBFactory
}

export class IdbRecordStore implements RecordStore {
  readonly capabilities: RecordStoreCapabilities = RECORD_STORE_CAPABILITIES

  private constructor(private db: IDBDatabase) {}

  static async open(
    archiveName: string,
    options?: CreateRecordStoreOptions,
  ): Promise<IdbRecordStore> {
    const factory = options?.indexedDB ?? globalThis.indexedDB
    if (!factory) {
      throw new Error('IdbRecordStore requires IndexedDB (none available in this environment)')
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(`fortemi-${archiveName}-records`, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        for (const collection of RECORD_COLLECTIONS) {
          if (!database.objectStoreNames.contains(collection)) {
            database.createObjectStore(collection, { keyPath: 'id' })
          }
        }
        if (!database.objectStoreNames.contains(JOURNAL_STORE)) {
          database.createObjectStore(JOURNAL_STORE, { keyPath: 'seq', autoIncrement: true })
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const store = new IdbRecordStore(db)
    await store.ensureSchemaVersion()
    return store
  }

  private async ensureSchemaVersion(): Promise<void> {
    const tx = this.db.transaction([META_STORE, 'collection'], 'readwrite')
    const meta = tx.objectStore(META_STORE)
    const current = await requestToPromise<number | undefined>(meta.get('schemaVersion'))
    if (current !== undefined && current > RECORD_SCHEMA_VERSION) {
      throw new Error(
        `IdbRecordStore: records were written by a newer schema (v${current} > v${RECORD_SCHEMA_VERSION}); refusing to open`,
      )
    }
    if ((current ?? 0) < 2) {
      const collections = await requestToPromise<Array<Record<string, unknown>>>(
        tx.objectStore('collection').getAll(),
      )
      for (const collection of collections) {
        if (!Object.hasOwn(collection, 'parent_id')) {
          tx.objectStore('collection').put({ ...collection, parent_id: null })
        }
      }
    }
    meta.put(RECORD_SCHEMA_VERSION, 'schemaVersion')
    await transactionComplete(tx)
  }

  async get<C extends RecordCollectionName>(
    collection: C,
    id: string,
  ): Promise<RecordCollections[C] | null> {
    const tx = this.db.transaction(collection, 'readonly')
    const result = await requestToPromise<RecordCollections[C] | undefined>(
      tx.objectStore(collection).get(id),
    )
    return result ?? null
  }

  async put<C extends RecordCollectionName>(
    collection: C,
    record: RecordCollections[C],
  ): Promise<JournalEntry> {
    const mutation = { op: 'put', collection, record } as RecordMutation
    return (await this.applyBatch([mutation]))[0]
  }

  async remove(collection: RecordCollectionName, id: string): Promise<JournalEntry> {
    return (await this.applyBatch([{ op: 'delete', collection, id }]))[0]
  }

  async applyBatch(mutations: readonly RecordMutation[]): Promise<JournalEntry[]> {
    if (mutations.length === 0) return []

    const normalizedMutations = mutations.map(normalizeRecordMutation)
    const collections = [...new Set(normalizedMutations.map((mutation) => mutation.collection))]
    const tx = this.db.transaction([...collections, JOURNAL_STORE], 'readwrite')
    const completed = transactionComplete(tx)
    const pendingEntries: Array<{
      pending: Omit<JournalEntry, 'seq'>
      seqRequest: IDBRequest<IDBValidKey>
    }> = []

    try {
      for (const mutation of normalizedMutations) {
        const records = tx.objectStore(mutation.collection)
        const pending: Omit<JournalEntry, 'seq'> = mutation.op === 'put'
          ? {
              ts: new Date().toISOString(),
              op: 'put',
              collection: mutation.collection,
              id: mutation.record.id,
              record: mutation.record,
            }
          : {
              ts: new Date().toISOString(),
              op: 'delete',
              collection: mutation.collection,
              id: mutation.id,
            }
        if (mutation.op === 'put') {
          records.put(mutation.record)
        } else {
          records.delete(mutation.id)
        }
        pendingEntries.push({
          pending,
          seqRequest: tx.objectStore(JOURNAL_STORE).add(pending),
        })
      }
    } catch (error) {
      tx.abort()
      try {
        await completed
      } catch {
        // The original synchronous mutation error is the useful failure.
      }
      throw error
    }

    await completed
    return pendingEntries.map(({ pending, seqRequest }) => ({
      ...pending,
      seq: seqRequest.result as number,
    }))
  }

  async list<C extends RecordCollectionName>(
    collection: C,
    opts?: RecordListOptions,
  ): Promise<RecordCollections[C][]> {
    const tx = this.db.transaction(collection, 'readonly')
    const store = tx.objectStore(collection)
    const all = await requestToPromise<RecordCollections[C][]>(
      opts?.limit !== undefined
        ? (store.getAll(undefined, opts.limit) as IDBRequest<RecordCollections[C][]>)
        : (store.getAll() as IDBRequest<RecordCollections[C][]>),
    )
    return all
  }

  async journalSince(sinceSeq: number, limit?: number): Promise<JournalEntry[]> {
    const tx = this.db.transaction(JOURNAL_STORE, 'readonly')
    const range = IDBKeyRange.lowerBound(sinceSeq, true)
    const entries = await requestToPromise<JournalEntry[]>(
      limit !== undefined
        ? (tx.objectStore(JOURNAL_STORE).getAll(range, limit) as IDBRequest<JournalEntry[]>)
        : (tx.objectStore(JOURNAL_STORE).getAll(range) as IDBRequest<JournalEntry[]>),
    )
    return entries
  }

  async headSeq(): Promise<number> {
    const tx = this.db.transaction(JOURNAL_STORE, 'readonly')
    const cursor = await requestToPromise<IDBCursorWithValue | null>(
      tx.objectStore(JOURNAL_STORE).openCursor(null, 'prev'),
    )
    return cursor ? (cursor.value as JournalEntry).seq : 0
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

/** Open the durable canonical record store for one archive namespace. */
export function createRecordStore(
  archiveName: string,
  options?: CreateRecordStoreOptions,
): Promise<IdbRecordStore> {
  return IdbRecordStore.open(archiveName, options)
}
