/**
 * In-memory RecordStore — the test/SSR tier of the canonical record layer.
 * Same commit semantics as the durable store: record + journal move together.
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
import { RECORD_STORE_CAPABILITIES } from './types.js'

export class MemoryRecordStore implements RecordStore {
  readonly capabilities: RecordStoreCapabilities = RECORD_STORE_CAPABILITIES
  private collections = new Map<RecordCollectionName, Map<string, unknown>>()
  private journal: JournalEntry[] = []
  private seq = 0

  private table(collection: RecordCollectionName): Map<string, unknown> {
    let table = this.collections.get(collection)
    if (!table) {
      table = new Map()
      this.collections.set(collection, table)
    }
    return table
  }

  async get<C extends RecordCollectionName>(
    collection: C,
    id: string,
  ): Promise<RecordCollections[C] | null> {
    return (this.table(collection).get(id) as RecordCollections[C] | undefined) ?? null
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

    const stagedCollections = new Map<RecordCollectionName, Map<string, unknown>>()
    for (const [collection, records] of this.collections) {
      stagedCollections.set(
        collection,
        new Map([...records].map(([id, record]) => [id, structuredClone(record)])),
      )
    }
    const stagedJournal = structuredClone(this.journal)
    let stagedSeq = this.seq
    const entries: JournalEntry[] = []
    const table = (collection: RecordCollectionName): Map<string, unknown> => {
      let records = stagedCollections.get(collection)
      if (!records) {
        records = new Map()
        stagedCollections.set(collection, records)
      }
      return records
    }

    for (const mutation of mutations) {
      const entry: JournalEntry = mutation.op === 'put'
        ? {
            seq: ++stagedSeq,
            ts: new Date().toISOString(),
            op: 'put',
            collection: mutation.collection,
            id: mutation.record.id,
            record: structuredClone(mutation.record),
          }
        : {
            seq: ++stagedSeq,
            ts: new Date().toISOString(),
            op: 'delete',
            collection: mutation.collection,
            id: mutation.id,
          }
      if (mutation.op === 'put') {
        table(mutation.collection).set(mutation.record.id, structuredClone(mutation.record))
      } else {
        table(mutation.collection).delete(mutation.id)
      }
      stagedJournal.push(entry)
      entries.push(entry)
    }

    this.collections = stagedCollections
    this.journal = stagedJournal
    this.seq = stagedSeq
    return entries
  }

  async list<C extends RecordCollectionName>(
    collection: C,
    opts?: RecordListOptions,
  ): Promise<RecordCollections[C][]> {
    const all = [...this.table(collection).values()] as RecordCollections[C][]
    return opts?.limit !== undefined ? all.slice(0, opts.limit) : all
  }

  async journalSince(sinceSeq: number, limit?: number): Promise<JournalEntry[]> {
    const entries = this.journal.filter((e) => e.seq > sinceSeq)
    return limit !== undefined ? entries.slice(0, limit) : entries
  }

  async headSeq(): Promise<number> {
    return this.seq
  }

  async close(): Promise<void> {
    // No external resources.
  }
}
