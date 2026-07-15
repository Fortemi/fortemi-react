/**
 * In-memory RecordStore — the test/SSR tier of the canonical record layer.
 * Same commit semantics as the durable store: record + journal move together.
 */

import type {
  JournalEntry,
  RecordCollectionName,
  RecordCollections,
  RecordListOptions,
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
    const entry: JournalEntry = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      op: 'put',
      collection,
      id: record.id,
      record: structuredClone(record),
    }
    this.table(collection).set(record.id, structuredClone(record))
    this.journal.push(entry)
    return entry
  }

  async remove(collection: RecordCollectionName, id: string): Promise<JournalEntry> {
    const entry: JournalEntry = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      op: 'delete',
      collection,
      id,
    }
    this.table(collection).delete(id)
    this.journal.push(entry)
    return entry
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
