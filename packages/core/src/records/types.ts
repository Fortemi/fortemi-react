/**
 * Canonical RecordStore contract — the writable structured-record layer that
 * exists independently of PGlite (#323, ADR-013 D3).
 *
 * Records mirror the browser SQL rows one-to-one (same field names, ISO-8601
 * timestamp strings) so the optional PGlite projection is a row-for-row
 * replay of the change journal — rebuildable at any time without touching
 * canonical records or attachment bytes.
 */

// ── Record shapes (projection-compatible with the SQL schema) ───────────────

export interface NoteRecord0 {
  id: string
  archive_id: string | null
  title: string | null
  format: string
  source: string
  visibility: string
  revision_mode: string
  is_starred: boolean
  is_pinned: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface NoteOriginalRecord {
  id: string
  note_id: string
  content: string
  content_hash: string
  created_at: string
}

export interface NoteRevisedCurrentRecord {
  /** Keyed by note id (mirrors the SQL PK `note_id`). */
  id: string
  content: string | null
  ai_metadata: unknown | null
  generation_count: number
  model: string | null
  is_user_edited: boolean
  updated_at: string
}

export interface NoteTagRecord {
  id: string
  note_id: string
  tag: string
  created_at: string
}

export interface LinkRecord0 {
  id: string
  source_note_id: string
  target_note_id: string
  link_type: string
  created_at: string
  deleted_at: string | null
}

export interface CollectionRecord {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CollectionNoteRecord {
  id: string
  collection_id: string
  note_id: string
  created_at: string
}

export interface AttachmentRecord {
  id: string
  note_id: string
  blob_id: string
  document_type_id: string | null
  mime_type: string | null
  extracted_text: string | null
  filename: string
  display_name: string | null
  position: number
  created_at: string
  deleted_at: string | null
}

export interface AttachmentBlobRecord {
  id: string
  content_hash: string
  size_bytes: number
  created_at: string
}

/** Collection name → record type. The store is generic over this map. */
export interface RecordCollections {
  note: NoteRecord0
  note_original: NoteOriginalRecord
  note_revised_current: NoteRevisedCurrentRecord
  note_tag: NoteTagRecord
  link: LinkRecord0
  collection: CollectionRecord
  collection_note: CollectionNoteRecord
  attachment: AttachmentRecord
  attachment_blob: AttachmentBlobRecord
}

export type RecordCollectionName = keyof RecordCollections

export const RECORD_COLLECTIONS: readonly RecordCollectionName[] = [
  'note',
  'note_original',
  'note_revised_current',
  'note_tag',
  'link',
  'collection',
  'collection_note',
  'attachment',
  'attachment_blob',
] as const

// ── Change journal ──────────────────────────────────────────────────────────

/**
 * One committed mutation. Journal entries carry the full record snapshot so
 * the PGlite projection (and any other consumer) can replay mutations without
 * re-reading canonical state, and so a rebuild has a total order to follow.
 */
export interface JournalEntry {
  /** Monotonically increasing commit sequence (assigned by the store). */
  seq: number
  /** ISO-8601 commit timestamp. */
  ts: string
  op: 'put' | 'delete'
  collection: RecordCollectionName
  id: string
  /** Snapshot for `put`; absent for `delete`. */
  record?: RecordCollections[RecordCollectionName]
}

// ── Capabilities ────────────────────────────────────────────────────────────

/**
 * What the canonical record tier can and cannot serve, reported explicitly
 * (never emulated badly). Advanced capabilities may require the optional
 * PGlite projection (ADR-013 D3).
 */
export interface RecordStoreCapabilities {
  crud: true
  journal: true
  /** Multi-collection record and journal mutations commit atomically. */
  atomicBatch?: true
  /** Bounded substring scan over titles/content — not ranked FTS. */
  boundedTextScan: true
  fullTextSearch: false
  vectorSearch: false
  sqlJoins: false
}

export const RECORD_STORE_CAPABILITIES: RecordStoreCapabilities = {
  crud: true,
  journal: true,
  atomicBatch: true,
  boundedTextScan: true,
  fullTextSearch: false,
  vectorSearch: false,
  sqlJoins: false,
}

// ── Store contract ──────────────────────────────────────────────────────────

export interface RecordListOptions {
  /** Maximum records returned (applied after filtering). */
  limit?: number
}

export type RecordMutation =
  | {
      [C in RecordCollectionName]: {
        op: 'put'
        collection: C
        record: RecordCollections[C]
      }
    }[RecordCollectionName]
  | {
      op: 'delete'
      collection: RecordCollectionName
      id: string
    }

/**
 * The writable canonical structured-record store. Implementations MUST make
 * each `put`/`remove` an atomic commit of the record mutation plus its
 * journal entry (the recoverable commit protocol): a torn write leaves
 * neither, never one without the other.
 */
export interface RecordStore {
  get<C extends RecordCollectionName>(
    collection: C,
    id: string,
  ): Promise<RecordCollections[C] | null>

  /** Insert or replace one record, journaled atomically. */
  put<C extends RecordCollectionName>(
    collection: C,
    record: RecordCollections[C],
  ): Promise<JournalEntry>

  /** Hard-remove one record, journaled atomically (soft-delete is a field upstream). */
  remove(collection: RecordCollectionName, id: string): Promise<JournalEntry>

  /**
   * Commit all record mutations and their journal entries as one transaction.
   * An error leaves both record state and the journal unchanged.
   */
  applyBatch?(mutations: readonly RecordMutation[]): Promise<JournalEntry[]>

  /** All records of a collection (insertion order not guaranteed). */
  list<C extends RecordCollectionName>(
    collection: C,
    opts?: RecordListOptions,
  ): Promise<RecordCollections[C][]>

  /** Journal entries with `seq > sinceSeq`, ascending. */
  journalSince(sinceSeq: number, limit?: number): Promise<JournalEntry[]>

  /** Highest committed sequence (0 when empty). */
  headSeq(): Promise<number>

  readonly capabilities: RecordStoreCapabilities

  close(): Promise<void>
}
