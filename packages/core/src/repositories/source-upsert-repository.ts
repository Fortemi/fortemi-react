import type { DatabaseClient, QueryExecutor } from '../storage-backend.js'
import { computeHash } from '../hash.js'
import { generateId } from '../uuid.js'
import type { TypedEventBus } from '../event-bus.js'

export const SOURCE_UPSERT_CONTRACT_VERSION = '1.0.0'
export const SOURCE_UPSERT_MAX_ITEMS = 500

export type SourceUpsertPolicy = 'replace' | 'version' | 'conflict'
export type SourceUpsertOutcome = 'inserted' | 'unchanged' | 'versioned' | 'replaced' | 'conflict' | 'rejected'
export type SourceUpsertBatchOutcome = 'committed' | 'duplicate' | 'preview' | 'rejected'
export type SourceUpsertReasonCode =
  | 'invalid_batch_metadata'
  | 'batch_size_out_of_bounds'
  | 'checkpoint_too_large'
  | 'invalid_item'
  | 'duplicate_external_id_in_batch'
  | 'content_digest_mismatch'
  | 'caller_stable_id_conflict'
  | 'batch_id_reused_with_different_request'

export interface SourceIdentityInput {
  tenant_id?: string
  archive_id?: string | null
  namespace: string
  external_id: string
  source_schema_version: string
  import_run_id: string
  source_id?: string
  workspace_id?: string
  caller_stable_id?: string
}

export interface SourceUpsertItem {
  source: SourceIdentityInput
  title?: string | null
  content: string
  content_digest?: string
  format?: string
  visibility?: string
  metadata?: Record<string, unknown> | null
  policy?: SourceUpsertPolicy
}

export interface SourceUpsertRequestItem {
  external_id: string
  content: string
  content_digest?: string
  caller_stable_id?: string
  title?: string
  format?: string
  metadata?: Record<string, unknown>
  policy?: SourceUpsertPolicy
}

export interface SourceUpsertRequest {
  source_namespace: string
  source_id?: string
  source_schema_version: string
  import_run_id: string
  batch_id?: string
  workspace_id?: string
  checkpoint?: Record<string, unknown>
  dry_run?: boolean
  policy?: SourceUpsertPolicy
  items: SourceUpsertRequestItem[]
}

export interface SourceUpsertScope {
  tenant_id?: string
  archive_id?: string | null
}

export interface SourceUpsertOptions {
  dryRun?: boolean
  maxItems?: number
  batchId?: string
  checkpoint?: Record<string, unknown>
  policy?: SourceUpsertPolicy
}

export interface SourceUpsertItemResult {
  index: number
  outcome: SourceUpsertOutcome
  note_id?: string
  external_id_hash: string
  content_digest: string
  reason_code?: SourceUpsertReasonCode
  /** @deprecated Use reason_code. Kept for source compatibility. */
  reason?: string
}

export interface SourceUpsertResponse {
  contract_version: typeof SOURCE_UPSERT_CONTRACT_VERSION
  import_run_id: string
  batch_id: string
  dry_run: boolean
  outcome: SourceUpsertBatchOutcome
  checkpoint?: Record<string, unknown>
  items: SourceUpsertItemResult[]
  counts: Record<SourceUpsertOutcome, number>
}

export interface SourceUpsertBatchResult extends SourceUpsertResponse {
  /** @deprecated Use items. Kept for source compatibility. */
  outcomes: SourceUpsertItemResult[]
}

interface StoredBatch {
  request_digest: string
  receipt: unknown
}

function assertSource(input: SourceIdentityInput): void {
  if (!input.tenant_id || input.tenant_id.length > 200) throw new Error('invalid_batch_metadata')
  if (!input.namespace || input.namespace.length > 200) throw new Error('invalid_batch_metadata')
  if (!input.external_id || input.external_id.length > 1000) throw new Error('invalid_item')
  if (!input.source_schema_version || input.source_schema_version.length > 100) throw new Error('invalid_batch_metadata')
  if (!input.import_run_id || input.import_run_id.length > 200) throw new Error('invalid_batch_metadata')
}

export function sourceIdentityHash(source: SourceIdentityInput): string {
  return computeHash(new TextEncoder().encode([
    source.tenant_id ?? 'default',
    source.archive_id ?? 'public',
    source.namespace,
    source.external_id,
    '',
  ].join('\0')))
}

export function sourceContentDigest(content: string): string {
  return computeHash(new TextEncoder().encode(content))
}

export function sourceRequestDigest(items: readonly SourceUpsertItem[], options: SourceUpsertOptions): string {
  return computeHash(new TextEncoder().encode(JSON.stringify({
    items: items.map((item) => ({
      source: item.source,
      title: item.title ?? null,
      content: item.content,
      content_digest: item.content_digest ?? null,
      format: item.format ?? 'markdown',
      visibility: item.visibility ?? 'private',
      metadata: item.metadata ?? null,
      policy: item.policy ?? options.policy ?? 'version',
    })),
    checkpoint: options.checkpoint ?? null,
    dry_run: options.dryRun === true,
  })))
}

export function deriveSourceBatchId(requestDigest: string): string {
  return `derived-${requestDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`
}

export function sourceRunRecordId(source: Pick<SourceIdentityInput, 'tenant_id' | 'archive_id' | 'namespace' | 'import_run_id'>): string {
  return computeHash(new TextEncoder().encode([
    source.tenant_id ?? 'default',
    source.archive_id ?? 'public',
    source.namespace,
    source.import_run_id,
    '',
  ].join('\0')))
}

function parseReceipt(value: unknown): SourceUpsertResponse | null {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!parsed || typeof parsed !== 'object') return null
  return parsed as SourceUpsertResponse
}

function duplicateReceipt(receipt: SourceUpsertResponse): SourceUpsertBatchResult {
  const items = receipt.items.map((item) => ({ ...item, outcome: 'unchanged' as const, reason: undefined, reason_code: undefined }))
  return finish(receipt.import_run_id, receipt.batch_id, false, 'duplicate', items, receipt.checkpoint)
}

async function insertNote(tx: QueryExecutor, input: SourceUpsertItem, noteId: string, digest: string): Promise<void> {
  const originalId = generateId()
  const revisionId = generateId()
  if (input.source.archive_id) {
    await tx.query('INSERT INTO archive (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [input.source.archive_id, input.source.archive_id])
  }
  await tx.query(
    `INSERT INTO note (id, archive_id, title, format, source, visibility)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [noteId, input.source.archive_id ?? null, input.title ?? null, input.format ?? 'markdown', `source:${input.source.namespace}`, input.visibility ?? 'private'],
  )
  await tx.query('INSERT INTO note_original (id, note_id, content, content_hash) VALUES ($1, $2, $3, $4)', [originalId, noteId, input.content, digest])
  await tx.query(
    `INSERT INTO note_revision (id, note_id, revision_number, type, content, ai_metadata)
     VALUES ($1, $2, 1, 'source-import', $3, $4::jsonb)`,
    [revisionId, noteId, input.content, JSON.stringify(input.metadata ?? null)],
  )
  await tx.query(
    `INSERT INTO note_revised_current (note_id, content, ai_metadata, last_revision_id)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [noteId, input.content, JSON.stringify(input.metadata ?? null), revisionId],
  )
}

async function updateNote(tx: QueryExecutor, input: SourceUpsertItem, noteId: string, outcome: 'replaced' | 'versioned', digest: string): Promise<void> {
  if (input.source.archive_id) {
    await tx.query('INSERT INTO archive (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [input.source.archive_id, input.source.archive_id])
  }
  // Serialize native revision allocation with repository and worker edits.
  await tx.query(
    `UPDATE note SET title = $1, format = $2, visibility = $3, archive_id = $4, updated_at = now(), deleted_at = NULL WHERE id = $5`,
    [input.title ?? null, input.format ?? 'markdown', input.visibility ?? 'private', input.source.archive_id ?? null, noteId],
  )
  let revisionId: string | null = null
  if (outcome === 'versioned') {
    const revision = await tx.query<{ next_revision: number }>(
      'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision FROM note_revision WHERE note_id = $1', [noteId],
    )
    revisionId = generateId()
    await tx.query(
      `INSERT INTO note_revision (id, note_id, revision_number, type, content, ai_metadata, parent_revision_id)
       VALUES ($1, $2, $3, 'source-import', $4, $5::jsonb,
         (SELECT id FROM note_revision WHERE note_id = $2 ORDER BY revision_number DESC LIMIT 1))`,
      [revisionId, noteId, Number(revision.rows[0].next_revision), input.content, JSON.stringify(input.metadata ?? null)],
    )
  } else {
    await tx.query(
      `INSERT INTO note_original_history (id, note_id, version_number, content, hash, created_at_utc, created_by)
       SELECT $1, note_id, version_number, content, content_hash,
         COALESCE(user_last_edited_at, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
         'source-import'
       FROM note_original WHERE note_id = $2`, [generateId(), noteId],
    )
    await tx.query(
      `UPDATE note_original SET content = $1, content_hash = $2, shard_export_present = TRUE,
         version_number = version_number + 1,
         user_last_edited_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       WHERE note_id = $3`, [input.content, digest, noteId],
    )
  }
  await tx.query(
    `UPDATE note_revised_current SET content = $1, ai_metadata = $2::jsonb, is_user_edited = false,
       updated_at = now(), last_revision_id = $4, shard_export_present = TRUE WHERE note_id = $3`,
    [input.content, JSON.stringify(input.metadata ?? null), noteId, revisionId],
  )
}

export class SourceUpsertRepository {
  constructor(private db: DatabaseClient, private events?: TypedEventBus) {}

  async upsertRequest(request: SourceUpsertRequest, scope: SourceUpsertScope = {}): Promise<SourceUpsertResponse> {
    const tenant = scope.tenant_id ?? 'default'
    const memory = scope.archive_id ?? null
    const items = request.items.map((item): SourceUpsertItem => ({
      source: {
        tenant_id: tenant,
        archive_id: memory,
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
    const invalidCommon = request.source_id !== undefined && (request.source_id.length === 0 || request.source_id.length > 500)
      || request.workspace_id !== undefined && (request.workspace_id.length === 0 || request.workspace_id.length > 500)
    if (invalidCommon) {
      const batchId = request.batch_id ?? deriveSourceBatchId(sourceRequestDigest(items, {}))
      const rejected = items.map((item, index): SourceUpsertItemResult => ({
        index,
        outcome: 'rejected',
        external_id_hash: sourceIdentityHash(item.source),
        content_digest: sourceContentDigest(item.content),
        reason_code: 'invalid_batch_metadata',
      }))
      return contractResponse(finish(request.import_run_id, batchId, request.dry_run === true, 'rejected', rejected, request.checkpoint))
    }
    return contractResponse(await this.upsertBatch(items, {
      dryRun: request.dry_run,
      batchId: request.batch_id,
      checkpoint: request.checkpoint,
      policy: request.policy,
    }))
  }

  async upsertBatch(items: readonly SourceUpsertItem[], options: SourceUpsertOptions = {}): Promise<SourceUpsertBatchResult> {
    const maxItems = options.maxItems ?? SOURCE_UPSERT_MAX_ITEMS
    const importRunId = items[0]?.source.import_run_id ?? ''
    const requestDigest = sourceRequestDigest(items, options)
    const batchId = options.batchId ?? deriveSourceBatchId(requestDigest)
    const batchReason: SourceUpsertReasonCode | undefined =
      batchId.length === 0 || batchId.length > 200
        ? 'invalid_batch_metadata'
        : JSON.stringify(options.checkpoint ?? {}).length > 65_536
          ? 'checkpoint_too_large'
          : undefined
    const validation = validateItems(items, maxItems, batchReason)
    if (validation) {
      return finish(importRunId, batchId, options.dryRun === true, 'rejected', validation, options.checkpoint)
    }

    if (options.dryRun) {
      const preview = await previewItems(this.db, items, options.policy)
      return finish(importRunId, batchId, true, 'preview', preview, options.checkpoint)
    }

    const response = await this.db.transaction(async (tx) => {
      const prior = await tx.query<StoredBatch>(
        `SELECT request_digest, receipt FROM source_import_batch
         WHERE tenant_id = $1 AND archive_id IS NOT DISTINCT FROM $2 AND namespace = $3 AND batch_id = $4 LIMIT 1`,
        [items[0].source.tenant_id ?? 'default', items[0].source.archive_id ?? null, items[0].source.namespace, batchId],
      )
      if (prior.rows[0]) {
        if (prior.rows[0].request_digest !== requestDigest) {
          const rejected = items.map((item, index): SourceUpsertItemResult => ({
            index,
            outcome: 'rejected',
            external_id_hash: sourceIdentityHash(item.source),
            content_digest: sourceContentDigest(item.content),
            reason_code: 'batch_id_reused_with_different_request',
          }))
          return finish(importRunId, batchId, false, 'rejected', rejected, options.checkpoint)
        }
        const receipt = parseReceipt(prior.rows[0].receipt)
        if (!receipt) throw new Error('Stored source upsert receipt is invalid')
        return duplicateReceipt(receipt)
      }

      for (const item of items) {
        if (!item.source.caller_stable_id) continue
        const collision = await tx.query<{ id: string }>('SELECT id FROM note WHERE id = $1 LIMIT 1', [item.source.caller_stable_id])
        if (collision.rows[0]) {
          const mapped = await findExisting(tx, item)
          if (mapped?.note_id === item.source.caller_stable_id) continue
          const rejected = items.map((candidate, index): SourceUpsertItemResult => ({
            index,
            outcome: 'rejected',
            external_id_hash: sourceIdentityHash(candidate.source),
            content_digest: sourceContentDigest(candidate.content),
            reason_code: 'caller_stable_id_conflict',
          }))
          return finish(importRunId, batchId, false, 'rejected', rejected, options.checkpoint)
        }
      }

      const outcomes: SourceUpsertItemResult[] = []
      for (const [index, item] of items.entries()) {
        const externalIdHash = sourceIdentityHash(item.source)
        const digest = sourceContentDigest(item.content)
        const existing = await findExisting(tx, item)
        if (!existing) {
          const noteId = item.source.caller_stable_id ?? generateId()
          await insertNote(tx, item, noteId, digest)
          await tx.query(
            `INSERT INTO source_identity
              (id, tenant_id, archive_id, namespace, external_id, external_id_hash, source_id, source_schema_version, content_digest, import_run_id, caller_stable_id, note_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [generateId(), item.source.tenant_id ?? 'default', item.source.archive_id ?? null, item.source.namespace, item.source.external_id, externalIdHash, item.source.source_id ?? null, item.source.source_schema_version, digest, item.source.import_run_id, item.source.caller_stable_id ?? null, noteId],
          )
          outcomes.push({ index, outcome: 'inserted', note_id: noteId, external_id_hash: externalIdHash, content_digest: digest })
          continue
        }
        if (existing.content_digest === digest) {
          outcomes.push({ index, outcome: 'unchanged', note_id: existing.note_id, external_id_hash: externalIdHash, content_digest: digest })
          continue
        }
        const policy = item.policy ?? options.policy ?? 'version'
        if (policy === 'conflict') {
          outcomes.push({ index, outcome: 'conflict', note_id: existing.note_id, external_id_hash: externalIdHash, content_digest: digest })
          continue
        }
        const outcome = policy === 'replace' ? 'replaced' : 'versioned'
        await updateNote(tx, item, existing.note_id, outcome, digest)
        await tx.query(
          `UPDATE source_identity SET source_id = $1, source_schema_version = $2, content_digest = $3, import_run_id = $4, updated_at = now()
           WHERE note_id = $5 AND tenant_id = $6 AND archive_id IS NOT DISTINCT FROM $7 AND namespace = $8 AND external_id = $9`,
          [item.source.source_id ?? null, item.source.source_schema_version, digest, item.source.import_run_id, existing.note_id, item.source.tenant_id ?? 'default', item.source.archive_id ?? null, item.source.namespace, item.source.external_id],
        )
        outcomes.push({ index, outcome, note_id: existing.note_id, external_id_hash: externalIdHash, content_digest: digest })
      }

      const committed = finish(importRunId, batchId, false, 'committed', outcomes, options.checkpoint)
      await tx.query(
        `INSERT INTO source_import_run (id, tenant_id, archive_id, namespace, external_run_id, source_id, source_schema_version, workspace_id, completed_at, checkpoint, receipt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9::jsonb, $10::jsonb)
         ON CONFLICT (id) DO UPDATE SET source_id = EXCLUDED.source_id, source_schema_version = EXCLUDED.source_schema_version, workspace_id = EXCLUDED.workspace_id, completed_at = EXCLUDED.completed_at, checkpoint = EXCLUDED.checkpoint, receipt = EXCLUDED.receipt`,
        [sourceRunRecordId(items[0].source), items[0].source.tenant_id ?? 'default', items[0].source.archive_id ?? null, items[0].source.namespace, importRunId, items[0].source.source_id ?? null, items[0].source.source_schema_version, items[0].source.workspace_id ?? null, JSON.stringify(options.checkpoint ?? {}), JSON.stringify(redactedReceipt(committed))],
      )
      await tx.query(
        `INSERT INTO source_import_batch (id, tenant_id, archive_id, namespace, batch_id, request_digest, import_run_id, outcome, checkpoint, receipt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'committed', $8::jsonb, $9::jsonb)`,
        [generateId(), items[0].source.tenant_id ?? 'default', items[0].source.archive_id ?? null, items[0].source.namespace, batchId, requestDigest, importRunId, JSON.stringify(options.checkpoint ?? {}), JSON.stringify(redactedReceipt(committed))],
      )
      return committed
    })

    if (response.outcome === 'committed' && hasMaterialChange(response.items)) {
      this.events?.emit('source.upserted', { importRunId, counts: response.counts })
    }
    return response
  }
}

async function findExisting(tx: QueryExecutor, item: SourceUpsertItem): Promise<{ note_id: string; content_digest: string } | null> {
  const result = await tx.query<{ note_id: string; content_digest: string }>(
    `SELECT note_id, content_digest FROM source_identity
     WHERE tenant_id = $1 AND archive_id IS NOT DISTINCT FROM $2 AND namespace = $3 AND external_id = $4 LIMIT 1`,
    [item.source.tenant_id ?? 'default', item.source.archive_id ?? null, item.source.namespace, item.source.external_id],
  )
  return result.rows[0] ?? null
}

async function previewItems(db: DatabaseClient, items: readonly SourceUpsertItem[], batchPolicy?: SourceUpsertPolicy): Promise<SourceUpsertItemResult[]> {
  const preview: SourceUpsertItemResult[] = []
  for (const [index, item] of items.entries()) {
    const external_id_hash = sourceIdentityHash(item.source)
    const content_digest = sourceContentDigest(item.content)
    const existing = await findExisting(db, item)
    if (!existing) preview.push({ index, outcome: 'inserted', external_id_hash, content_digest })
    else if (existing.content_digest === content_digest) preview.push({ index, outcome: 'unchanged', note_id: existing.note_id, external_id_hash, content_digest })
    else if ((item.policy ?? batchPolicy ?? 'version') === 'conflict') preview.push({ index, outcome: 'conflict', note_id: existing.note_id, external_id_hash, content_digest })
    else preview.push({ index, outcome: (item.policy ?? batchPolicy) === 'replace' ? 'replaced' : 'versioned', note_id: existing.note_id, external_id_hash, content_digest })
  }
  return preview
}

function validateItems(
  items: readonly SourceUpsertItem[],
  maxItems: number,
  initialReason?: SourceUpsertReasonCode,
): SourceUpsertItemResult[] | null {
  const seen = new Set<string>()
  const stableIds = new Set<string>()
  const rejected: SourceUpsertItemResult[] = []
  let batchReason: SourceUpsertReasonCode | null = initialReason ?? (items.length === 0 || items.length > maxItems ? 'batch_size_out_of_bounds' : null)
  for (const [index, item] of items.entries()) {
    const digest = sourceContentDigest(item.content ?? '')
    let reason: SourceUpsertReasonCode | null = batchReason
    try {
      assertSource(item.source)
      if (!item.content || item.content.length > 4_194_304) reason ??= 'invalid_item'
      if ((item.format ?? 'markdown').length > 100 || (item.title?.length ?? 0) > 2000 || JSON.stringify(item.metadata ?? {}).length > 262_144) reason ??= 'invalid_item'
      if (item.content_digest && item.content_digest !== digest) reason ??= 'content_digest_mismatch'
      const identity = `${item.source.tenant_id ?? 'default'}\0${item.source.archive_id ?? ''}\0${item.source.namespace}\0${item.source.external_id}`
      if (seen.has(identity)) reason ??= 'duplicate_external_id_in_batch'
      seen.add(identity)
      if (item.source.caller_stable_id && stableIds.has(item.source.caller_stable_id)) reason ??= 'caller_stable_id_conflict'
      if (item.source.caller_stable_id) stableIds.add(item.source.caller_stable_id)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_item'
      reason ??= code === 'invalid_batch_metadata' ? code : 'invalid_item'
    }
    if (reason) {
      batchReason = reason
      rejected.push({ index, outcome: 'rejected', external_id_hash: sourceIdentityHash(item.source), content_digest: digest, reason_code: reason })
    }
  }
  if (!batchReason) return null
  if (rejected.length === items.length) return rejected
  return items.map((item, index) => rejected.find((result) => result.index === index) ?? ({
    index,
    outcome: 'rejected' as const,
    external_id_hash: sourceIdentityHash(item.source),
    content_digest: sourceContentDigest(item.content),
    reason_code: batchReason!,
  }))
}

function finish(
  importRunId: string,
  batchId: string,
  dryRun: boolean,
  outcome: SourceUpsertBatchOutcome,
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

function redactedReceipt(receipt: SourceUpsertBatchResult): SourceUpsertResponse {
  return { ...contractResponse(receipt), items: receipt.items.map(sanitizeItem) }
}

function contractResponse(receipt: SourceUpsertBatchResult): SourceUpsertResponse {
  return {
    contract_version: receipt.contract_version,
    import_run_id: receipt.import_run_id,
    batch_id: receipt.batch_id,
    dry_run: receipt.dry_run,
    outcome: receipt.outcome,
    ...(receipt.checkpoint ? { checkpoint: receipt.checkpoint } : {}),
    counts: receipt.counts,
    items: receipt.items,
  }
}

function sanitizeItem(item: SourceUpsertItemResult): SourceUpsertItemResult {
  return {
    index: item.index,
    outcome: item.outcome,
    ...(item.note_id ? { note_id: item.note_id } : {}),
    external_id_hash: item.external_id_hash,
    content_digest: item.content_digest,
    ...(item.reason_code ? { reason_code: item.reason_code } : {}),
  }
}

function hasMaterialChange(outcomes: readonly SourceUpsertItemResult[]): boolean {
  return outcomes.some((item) => item.outcome === 'inserted' || item.outcome === 'versioned' || item.outcome === 'replaced')
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
