import { computeHash } from '../hash.js'
import { generateId } from '../uuid.js'
import type { DeletionReceipt, PurgeCounts, PurgePreview, PurgeSelector } from '../repositories/lifecycle-purge-repository.js'
import type { DeletionReceiptRecord, RecordMutation, RecordStore } from './types.js'

function hashSelector(selector: PurgeSelector): string {
  return computeHash(new TextEncoder().encode(JSON.stringify({
    tenant_id: selector.tenant_id ?? 'default',
    archive_id: selector.archive_id ?? null,
    note_ids: [...(selector.note_ids ?? [])].sort(),
    source: selector.source
      ? {
          namespace: selector.source.namespace,
          external_id_hash: selector.source.external_id
            ? computeHash(new TextEncoder().encode(selector.source.external_id))
            : null,
        }
      : null,
  })))
}

function zeroCounts(): PurgeCounts {
  return {
    notes: 0,
    revisions: 0,
    links: 0,
    tags: 0,
    embeddings: 0,
    attachments: 0,
    blobs: 0,
    graph_edges: 0,
    provenance_edges: 0,
    source_identities: 0,
  }
}

async function selectedNoteIds(store: RecordStore, selector: PurgeSelector): Promise<string[]> {
  const notes = await store.list('note')
  if (selector.note_ids?.length) return notes.filter((note) => selector.note_ids!.includes(note.id)).map((note) => note.id)
  if (!selector.source) throw new Error('Purge selector must target note_ids or source identity')
  const identities = await store.list('source_identity')
  return identities
    .filter((identity) => (
      identity.tenant_id === (selector.tenant_id ?? 'default')
      && identity.archive_id === (selector.archive_id ?? null)
      && identity.namespace === selector.source!.namespace
      && (selector.source!.external_id === undefined || identity.external_id === selector.source!.external_id)
    ))
    .map((identity) => identity.note_id)
}

async function count(store: RecordStore, noteIds: readonly string[]): Promise<PurgeCounts> {
  const counts = zeroCounts()
  if (noteIds.length === 0) return counts
  const noteSet = new Set(noteIds)
  counts.notes = (await store.list('note')).filter((record) => noteSet.has(record.id)).length
  counts.revisions = 0
  counts.links = (await store.list('link')).filter((record) => noteSet.has(record.source_note_id) || noteSet.has(record.target_note_id)).length
  counts.tags = (await store.list('note_tag')).filter((record) => noteSet.has(record.note_id)).length
  counts.attachments = (await store.list('attachment')).filter((record) => noteSet.has(record.note_id)).length
  const purgedBlobIds = new Set((await store.list('attachment')).filter((record) => noteSet.has(record.note_id)).map((record) => record.blob_id))
  counts.blobs = (await store.list('attachment_blob')).filter((record) => purgedBlobIds.has(record.id)).length
  counts.source_identities = (await store.list('source_identity')).filter((record) => noteSet.has(record.note_id)).length
  return counts
}

export async function previewRecordStorePurge(store: RecordStore, selector: PurgeSelector): Promise<PurgePreview> {
  return { selector_hash: hashSelector(selector), counts: await count(store, await selectedNoteIds(store, selector)) }
}

export async function purgeRecordStoreGraph(store: RecordStore, selector: PurgeSelector, operationKey: string): Promise<DeletionReceipt> {
  if (!store.applyBatch) throw new Error('RecordStore purge requires atomic applyBatch() support')
  const prior = (await store.list('deletion_receipt')).find((receipt) => receipt.operation_key === operationKey)
  if (prior) return {
    id: prior.id,
    operation_key: prior.operation_key,
    tenant_id: prior.tenant_id,
    archive_id: prior.archive_id,
    selector_hash: prior.selector_hash,
    outcome: 'completed',
    counts: prior.counts as unknown as PurgeCounts,
    completed_at: prior.completed_at,
    policy: prior.policy as DeletionReceipt['policy'],
  }

  const noteIds = await selectedNoteIds(store, selector)
  const noteSet = new Set(noteIds)
  const counts = await count(store, noteIds)
  const mutations: RecordMutation[] = []

  for (const collection of ['note_revised_current', 'note_original', 'note_tag', 'collection_note', 'attachment', 'source_identity'] as const) {
    for (const record of await store.list(collection)) {
      const noteId = collection === 'note_revised_current'
        ? record.id
        : 'note_id' in record && typeof record.note_id === 'string'
          ? record.note_id
          : null
      if (noteId && noteSet.has(noteId)) {
        mutations.push({ op: 'delete', collection, id: record.id })
      }
    }
  }
  for (const record of await store.list('link')) {
    if (noteSet.has(record.source_note_id) || noteSet.has(record.target_note_id)) mutations.push({ op: 'delete', collection: 'link', id: record.id })
  }
  for (const record of await store.list('note')) {
    if (noteSet.has(record.id)) mutations.push({ op: 'delete', collection: 'note', id: record.id })
  }
  const liveBlobIds = new Set((await store.list('attachment')).filter((record) => !noteSet.has(record.note_id)).map((record) => record.blob_id))
  for (const record of await store.list('attachment_blob')) {
    if (!liveBlobIds.has(record.id)) mutations.push({ op: 'delete', collection: 'attachment_blob', id: record.id })
  }

  const receipt: DeletionReceiptRecord = {
    id: generateId(),
    operation_key: operationKey,
    tenant_id: selector.tenant_id ?? 'default',
    archive_id: selector.archive_id ?? null,
    selector_hash: hashSelector(selector),
    outcome: 'completed',
    counts: counts as unknown as Record<string, number>,
    completed_at: new Date().toISOString(),
    policy: {
      authority: 'fortemi#1092',
      mode: 'terminal-purge',
      receipt_contains_content: false,
    },
  }
  mutations.push({ op: 'put', collection: 'deletion_receipt', record: receipt })
  await store.applyBatch(mutations)
  return {
    id: receipt.id,
    operation_key: receipt.operation_key,
    tenant_id: receipt.tenant_id,
    archive_id: receipt.archive_id,
    selector_hash: receipt.selector_hash,
    outcome: 'completed',
    counts,
    completed_at: receipt.completed_at,
    policy: receipt.policy as DeletionReceipt['policy'],
  }
}
