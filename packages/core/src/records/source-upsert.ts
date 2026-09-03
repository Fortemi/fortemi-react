import { generateId } from '../uuid.js'
import type {
  NoteOriginalRecord,
  NoteRecord0,
  NoteRevisedCurrentRecord,
  NoteRevisionRecord,
  RecordMutation,
  RecordStore,
  SourceIdentityRecord,
  SourceImportBatchRecord,
  SourceImportRunRecord,
} from './types.js'
import {
  deriveSourceBatchId,
  SOURCE_UPSERT_CONTRACT_VERSION,
  sourceContentDigest,
  sourceIdentityHash,
  sourceRequestDigest,
  sourceRunRecordId,
  type SourceIdentityInput,
  type SourceUpsertBatchResult,
  type SourceUpsertItem,
  type SourceUpsertItemResult,
  type SourceUpsertOptions,
  type SourceUpsertOutcome,
  type SourceUpsertRequest,
  type SourceUpsertResponse,
  type SourceUpsertScope,
} from '../repositories/source-upsert-repository.js'

function now(): string {
  return new Date().toISOString()
}

function countOutcomes(outcomes: readonly SourceUpsertItemResult[]): Record<SourceUpsertOutcome, number> {
  return {
    inserted: outcomes.filter((item) => item.outcome === 'inserted').length,
    unchanged: outcomes.filter((item) => item.outcome === 'unchanged').length,
    versioned: outcomes.filter((item) => item.outcome === 'versioned').length,
    replaced: outcomes.filter((item) => item.outcome === 'replaced').length,
    conflict: outcomes.filter((item) => item.outcome === 'conflict').length,
    rejected: outcomes.filter((item) => item.outcome === 'rejected').length,
  }
}

function finish(
  importRunId: string,
  batchId: string,
  dryRun: boolean,
  outcome: SourceUpsertBatchResult['outcome'],
  items: SourceUpsertItemResult[],
  checkpoint?: Record<string, unknown>,
): SourceUpsertBatchResult {
  return {
    contract_version: SOURCE_UPSERT_CONTRACT_VERSION,
    import_run_id: importRunId,
    batch_id: batchId,
    dry_run: dryRun,
    outcome,
    ...(checkpoint ? { checkpoint } : {}),
    items,
    outcomes: items,
    counts: countOutcomes(items),
  }
}

async function findSource(store: RecordStore, source: SourceIdentityInput): Promise<SourceIdentityRecord | null> {
  const identities = await store.list('source_identity')
  return identities.find((identity) => (
    identity.tenant_id === (source.tenant_id ?? 'default')
    && identity.archive_id === (source.archive_id ?? null)
    && identity.namespace === source.namespace
    && identity.external_id === source.external_id
  )) ?? null
}

export async function upsertRecordStoreRequest(
  store: RecordStore,
  request: SourceUpsertRequest,
  scope: SourceUpsertScope = {},
): Promise<SourceUpsertResponse> {
  const items = request.items.map((item): SourceUpsertItem => ({
    source: {
      tenant_id: scope.tenant_id ?? 'default',
      archive_id: scope.archive_id ?? null,
      namespace: request.source_namespace,
      external_id: item.external_id,
      source_schema_version: request.source_schema_version,
      import_run_id: request.import_run_id,
      source_id: request.source_id,
      workspace_id: request.workspace_id,
      caller_stable_id: item.caller_stable_id,
    },
    title: item.title,
    content: item.content,
    content_digest: item.content_digest,
    format: item.format,
    metadata: item.metadata,
    policy: item.policy ?? request.policy,
  }))
  const result = await upsertRecordStoreSources(store, items, {
    dryRun: request.dry_run,
    batchId: request.batch_id,
    checkpoint: request.checkpoint,
    policy: request.policy,
  })
  return {
    contract_version: result.contract_version,
    import_run_id: result.import_run_id,
    batch_id: result.batch_id,
    dry_run: result.dry_run,
    outcome: result.outcome,
    ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
    counts: result.counts,
    items: result.items,
  }
}

export async function upsertRecordStoreSources(
  store: RecordStore,
  items: readonly SourceUpsertItem[],
  options: SourceUpsertOptions = {},
): Promise<SourceUpsertBatchResult> {
  if (!store.applyBatch) throw new Error('RecordStore source upsert requires atomic applyBatch() support')
  const importRunId = items[0]?.source.import_run_id ?? ''
  const requestDigest = sourceRequestDigest(items, options)
  const batchId = options.batchId ?? deriveSourceBatchId(requestDigest)
  const batchReason: SourceUpsertItemResult['reason_code'] | undefined =
    batchId.length === 0 || batchId.length > 200
      ? 'invalid_batch_metadata'
      : JSON.stringify(options.checkpoint ?? {}).length > 65_536
        ? 'checkpoint_too_large'
        : undefined
  const validation = validate(items, options.maxItems ?? 500, batchReason)
  if (validation) return finish(importRunId, batchId, options.dryRun === true, 'rejected', validation, options.checkpoint)

  const batches = await store.list('source_import_batch')
  const prior = batches.find((batch) => (
    batch.tenant_id === (items[0].source.tenant_id ?? 'default')
    && batch.archive_id === (items[0].source.archive_id ?? null)
    && batch.namespace === items[0].source.namespace
    && batch.batch_id === batchId
  ))
  if (prior) {
    if (prior.request_digest !== requestDigest) {
      const rejected = items.map((item, index): SourceUpsertItemResult => ({
        index,
        outcome: 'rejected',
        external_id_hash: sourceIdentityHash(item.source),
        content_digest: sourceContentDigest(item.content),
        reason_code: 'batch_id_reused_with_different_request',
      }))
      return finish(importRunId, batchId, false, 'rejected', rejected, options.checkpoint)
    }
    const receipt = prior.receipt as unknown as SourceUpsertBatchResult
    const unchanged = receipt.items.map((item) => ({ ...item, outcome: 'unchanged' as const, reason_code: undefined, reason: undefined }))
    return finish(importRunId, batchId, false, 'duplicate', unchanged, receipt.checkpoint)
  }

  const outcomes: SourceUpsertItemResult[] = []
  const mutations: RecordMutation[] = []
  const stamp = now()
  for (const [index, item] of items.entries()) {
    const external_id_hash = sourceIdentityHash(item.source)
    const content_digest = sourceContentDigest(item.content)
    const existing = await findSource(store, item.source)
    if (!existing) {
      const noteId = item.source.caller_stable_id ?? generateId()
      if (await store.get('note', noteId)) {
        const rejected = items.map((candidate, candidateIndex): SourceUpsertItemResult => ({
          index: candidateIndex,
          outcome: 'rejected',
          external_id_hash: sourceIdentityHash(candidate.source),
          content_digest: sourceContentDigest(candidate.content),
          reason_code: 'caller_stable_id_conflict',
        }))
        return finish(importRunId, batchId, false, 'rejected', rejected, options.checkpoint)
      }
      outcomes.push({ index, outcome: 'inserted', note_id: noteId, external_id_hash, content_digest })
      if (!options.dryRun) addInsertMutations(mutations, item, noteId, content_digest, external_id_hash, stamp)
      continue
    }

    if (existing.content_digest === content_digest) {
      outcomes.push({ index, outcome: 'unchanged', note_id: existing.note_id, external_id_hash, content_digest })
      continue
    }
    const policy = item.policy ?? options.policy ?? 'version'
    if (policy === 'conflict') {
      outcomes.push({ index, outcome: 'conflict', note_id: existing.note_id, external_id_hash, content_digest })
      continue
    }
    const note = await store.get('note', existing.note_id)
    const current = await store.get('note_revised_current', existing.note_id)
    const originals = await store.list('note_original')
    const original = originals.find((candidate) => candidate.note_id === existing.note_id)
    if (!note || !current || !original) {
      const rejected = items.map((candidate, candidateIndex): SourceUpsertItemResult => ({
        index: candidateIndex,
        outcome: 'rejected',
        note_id: candidateIndex === index ? existing.note_id : undefined,
        external_id_hash: sourceIdentityHash(candidate.source),
        content_digest: sourceContentDigest(candidate.content),
        reason_code: 'invalid_item',
      }))
      return finish(importRunId, batchId, false, 'rejected', rejected, options.checkpoint)
    }
    const outcome = policy === 'replace' ? 'replaced' : 'versioned'
    outcomes.push({ index, outcome, note_id: existing.note_id, external_id_hash, content_digest })
    if (!options.dryRun) {
      const revisionNumber = outcome === 'versioned'
        ? (await store.list('note_revision')).filter((row) => row.note_id === existing.note_id).length + 1
        : undefined
      addUpdateMutations(mutations, item, existing, note, current, original, outcome, content_digest, stamp, revisionNumber)
    }
  }

  if (options.dryRun) return finish(importRunId, batchId, true, 'preview', outcomes, options.checkpoint)

  const committed = finish(importRunId, batchId, false, 'committed', outcomes, options.checkpoint)
  const contractReceipt: SourceUpsertResponse = {
    contract_version: committed.contract_version,
    import_run_id: committed.import_run_id,
    batch_id: committed.batch_id,
    dry_run: committed.dry_run,
    outcome: committed.outcome,
    ...(committed.checkpoint ? { checkpoint: committed.checkpoint } : {}),
    counts: committed.counts,
    items: committed.items,
  }
  const run: SourceImportRunRecord = {
    id: sourceRunRecordId(items[0].source),
    external_run_id: importRunId,
    source_id: items[0].source.source_id ?? null,
    source_schema_version: items[0].source.source_schema_version,
    workspace_id: items[0].source.workspace_id ?? null,
    tenant_id: items[0].source.tenant_id ?? 'default',
    archive_id: items[0].source.archive_id ?? null,
    namespace: items[0].source.namespace,
    started_at: stamp,
    completed_at: stamp,
    checkpoint: options.checkpoint ?? {},
    receipt: contractReceipt as unknown as Record<string, unknown>,
  }
  const batch: SourceImportBatchRecord = {
    id: generateId(),
    tenant_id: items[0].source.tenant_id ?? 'default',
    archive_id: items[0].source.archive_id ?? null,
    namespace: items[0].source.namespace,
    batch_id: batchId,
    request_digest: requestDigest,
    import_run_id: importRunId,
    outcome: 'committed',
    checkpoint: options.checkpoint ?? {},
    receipt: contractReceipt as unknown as Record<string, unknown>,
    created_at: stamp,
  }
  mutations.push(
    { op: 'put', collection: 'source_import_run', record: run },
    { op: 'put', collection: 'source_import_batch', record: batch },
  )
  await store.applyBatch(mutations)
  return committed
}

function addInsertMutations(
  mutations: RecordMutation[],
  item: SourceUpsertItem,
  noteId: string,
  contentDigest: string,
  externalIdHash: string,
  stamp: string,
): void {
  const note: NoteRecord0 = {
    id: noteId,
    archive_id: item.source.archive_id ?? null,
    title: item.title ?? null,
    format: item.format ?? 'markdown',
    source: `source:${item.source.namespace}`,
    visibility: item.visibility ?? 'private',
    revision_mode: 'standard',
    is_starred: false,
    is_pinned: false,
    is_archived: false,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
  }
  const original: NoteOriginalRecord = { id: generateId(), note_id: noteId, content: item.content, content_hash: contentDigest, created_at: stamp }
  const current: NoteRevisedCurrentRecord = { id: noteId, content: item.content, ai_metadata: item.metadata ?? null, generation_count: 0, model: null, is_user_edited: false, updated_at: stamp }
  const revision: NoteRevisionRecord = { id: generateId(), note_id: noteId, revision_number: 1, type: 'source-import', content: item.content, ai_metadata: item.metadata ?? null, model: null, created_at: stamp }
  const identity: SourceIdentityRecord = {
    id: generateId(),
    tenant_id: item.source.tenant_id ?? 'default',
    archive_id: item.source.archive_id ?? null,
    namespace: item.source.namespace,
    external_id: item.source.external_id,
    external_id_hash: externalIdHash,
    source_id: item.source.source_id ?? null,
    source_schema_version: item.source.source_schema_version,
    content_digest: contentDigest,
    import_run_id: item.source.import_run_id,
    caller_stable_id: item.source.caller_stable_id ?? null,
    note_id: noteId,
    created_at: stamp,
    updated_at: stamp,
  }
  mutations.push(
    { op: 'put', collection: 'note', record: note },
    { op: 'put', collection: 'note_original', record: original },
    { op: 'put', collection: 'note_revised_current', record: current },
    { op: 'put', collection: 'note_revision', record: revision },
    { op: 'put', collection: 'source_identity', record: identity },
  )
}

function addUpdateMutations(
  mutations: RecordMutation[],
  item: SourceUpsertItem,
  identity: SourceIdentityRecord,
  note: NoteRecord0,
  current: NoteRevisedCurrentRecord,
  original: NoteOriginalRecord,
  outcome: 'replaced' | 'versioned',
  contentDigest: string,
  stamp: string,
  revisionNumber?: number,
): void {
  mutations.push(
    { op: 'put', collection: 'note', record: { ...note, title: item.title ?? null, archive_id: item.source.archive_id ?? null, format: item.format ?? 'markdown', visibility: item.visibility ?? 'private', deleted_at: null, updated_at: stamp } },
    { op: 'put', collection: 'note_revised_current', record: { ...current, content: item.content, ai_metadata: item.metadata ?? null, is_user_edited: false, updated_at: stamp } },
    { op: 'put', collection: 'source_identity', record: { ...identity, source_id: item.source.source_id ?? null, source_schema_version: item.source.source_schema_version, content_digest: contentDigest, import_run_id: item.source.import_run_id, updated_at: stamp } },
  )
  if (outcome === 'replaced') {
    mutations.push({ op: 'put', collection: 'note_original', record: { ...original, content: item.content, content_hash: contentDigest } })
  } else {
    const revision: NoteRevisionRecord = {
      id: generateId(),
      note_id: identity.note_id,
      revision_number: revisionNumber ?? 1,
      type: 'source-import',
      content: item.content,
      ai_metadata: item.metadata ?? null,
      model: null,
      created_at: stamp,
    }
    mutations.push({ op: 'put', collection: 'note_revision', record: revision })
  }
}

function validate(
  items: readonly SourceUpsertItem[],
  maxItems: number,
  initialReason?: SourceUpsertItemResult['reason_code'],
): SourceUpsertItemResult[] | null {
  let reason: SourceUpsertItemResult['reason_code'] | null = initialReason ?? (items.length === 0 || items.length > maxItems ? 'batch_size_out_of_bounds' : null)
  const seen = new Set<string>()
  const stableIds = new Set<string>()
  for (const item of items) {
    if (!item.source.tenant_id || !item.source.namespace || !item.source.external_id || !item.source.source_schema_version || !item.source.import_run_id || !item.content) reason ??= 'invalid_item'
    if ((item.source.source_id?.length ?? 0) > 500 || item.source.source_id === '' || (item.source.workspace_id?.length ?? 0) > 500 || item.source.workspace_id === '') reason ??= 'invalid_batch_metadata'
    if ((item.format ?? 'markdown').length > 100 || (item.title?.length ?? 0) > 2000 || JSON.stringify(item.metadata ?? {}).length > 262_144) reason ??= 'invalid_item'
    if (item.content_digest && item.content_digest !== sourceContentDigest(item.content)) reason ??= 'content_digest_mismatch'
    const key = `${item.source.tenant_id}\0${item.source.archive_id ?? ''}\0${item.source.namespace}\0${item.source.external_id}`
    if (seen.has(key)) reason ??= 'duplicate_external_id_in_batch'
    seen.add(key)
    if (item.source.caller_stable_id && stableIds.has(item.source.caller_stable_id)) reason ??= 'caller_stable_id_conflict'
    if (item.source.caller_stable_id) stableIds.add(item.source.caller_stable_id)
  }
  if (!reason) return null
  return items.map((item, index) => ({
    index,
    outcome: 'rejected',
    external_id_hash: sourceIdentityHash(item.source),
    content_digest: sourceContentDigest(item.content ?? ''),
    reason_code: reason!,
  }))
}
