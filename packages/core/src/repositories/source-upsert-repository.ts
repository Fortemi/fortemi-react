import type { DatabaseClient, QueryExecutor } from '../storage-backend.js'
import { computeHash } from '../hash.js'
import { generateId } from '../uuid.js'
import type { TypedEventBus } from '../event-bus.js'

export type SourceUpsertPolicy = 'replace' | 'version' | 'conflict'
export type SourceUpsertOutcome = 'inserted' | 'unchanged' | 'versioned' | 'replaced' | 'conflict' | 'rejected'

export interface SourceIdentityInput {
  tenant_id?: string
  archive_id?: string | null
  namespace: string
  external_id: string
  source_schema_version: string
  import_run_id: string
  caller_stable_id?: string
}

export interface SourceUpsertItem {
  source: SourceIdentityInput
  title?: string | null
  content: string
  format?: string
  visibility?: string
  metadata?: Record<string, unknown> | null
  policy?: SourceUpsertPolicy
}

export interface SourceUpsertOptions {
  dryRun?: boolean
  maxItems?: number
}

export interface SourceUpsertItemResult {
  index: number
  outcome: SourceUpsertOutcome
  note_id?: string
  external_id_hash: string
  content_digest: string
  reason?: string
}

export interface SourceUpsertBatchResult {
  import_run_id: string
  dry_run: boolean
  outcomes: SourceUpsertItemResult[]
  counts: Record<SourceUpsertOutcome, number>
}

const DEFAULT_MAX_ITEMS = 500

function assertSource(input: SourceIdentityInput): void {
  if (!input.namespace || input.namespace.length > 128) throw new Error('Source namespace is required and must be <= 128 characters')
  if (!input.external_id || input.external_id.length > 1024) throw new Error('Source external_id is required and must be <= 1024 characters')
  if (!input.source_schema_version || input.source_schema_version.length > 64) {
    throw new Error('Source schema version is required and must be <= 64 characters')
  }
  if (!input.import_run_id || input.import_run_id.length > 128) throw new Error('Source import_run_id is required and must be <= 128 characters')
}

function sourceHash(source: SourceIdentityInput): string {
  return computeHash(new TextEncoder().encode([
    source.tenant_id ?? 'default',
    source.archive_id ?? '',
    source.namespace,
    source.external_id,
  ].join('\0')))
}

function contentDigest(content: string): string {
  return computeHash(new TextEncoder().encode(content))
}

async function insertNote(
  tx: QueryExecutor,
  input: SourceUpsertItem,
  noteId: string,
  digest: string,
): Promise<void> {
  const originalId = generateId()
  if (input.source.archive_id) {
    await tx.query(
      `INSERT INTO archive (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [input.source.archive_id, input.source.archive_id],
    )
  }
  await tx.query(
    `INSERT INTO note (id, archive_id, title, format, source, visibility)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      noteId,
      input.source.archive_id ?? null,
      input.title ?? null,
      input.format ?? 'markdown',
      `source:${input.source.namespace}`,
      input.visibility ?? 'private',
    ],
  )
  await tx.query(
    `INSERT INTO note_original (id, note_id, content, content_hash)
     VALUES ($1, $2, $3, $4)`,
    [originalId, noteId, input.content, digest],
  )
  await tx.query(
    `INSERT INTO note_revised_current (note_id, content, ai_metadata)
     VALUES ($1, $2, $3::jsonb)`,
    [noteId, input.content, JSON.stringify(input.metadata ?? null)],
  )
}

async function updateNote(
  tx: QueryExecutor,
  input: SourceUpsertItem,
  noteId: string,
  outcome: 'replaced' | 'versioned',
): Promise<void> {
  if (input.source.archive_id) {
    await tx.query(
      `INSERT INTO archive (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [input.source.archive_id, input.source.archive_id],
    )
  }
  if (outcome === 'versioned') {
    const count = await tx.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM note_revision WHERE note_id = $1`,
      [noteId],
    )
    const current = await tx.query<{ content: string; ai_metadata: unknown | null }>(
      `SELECT content, ai_metadata FROM note_revised_current WHERE note_id = $1`,
      [noteId],
    )
    const nextRevision = Number.parseInt(count.rows[0]?.count ?? '0', 10) + 1
    if (current.rows[0]) {
      await tx.query(
        `INSERT INTO note_revision (id, note_id, revision_number, type, content, ai_metadata)
         VALUES ($1, $2, $3, 'source-import', $4, $5::jsonb)`,
        [
          generateId(),
          noteId,
          nextRevision,
          current.rows[0].content,
          JSON.stringify(current.rows[0].ai_metadata ?? null),
        ],
      )
    }
  }
  await tx.query(
    `UPDATE note
     SET title = $1, format = $2, visibility = $3, archive_id = $4, updated_at = now(), deleted_at = NULL
     WHERE id = $5`,
    [
      input.title ?? null,
      input.format ?? 'markdown',
      input.visibility ?? 'private',
      input.source.archive_id ?? null,
      noteId,
    ],
  )
  await tx.query(
    `UPDATE note_revised_current
     SET content = $1, ai_metadata = $2::jsonb, is_user_edited = false, updated_at = now()
     WHERE note_id = $3`,
    [input.content, JSON.stringify(input.metadata ?? null), noteId],
  )
}

export class SourceUpsertRepository {
  constructor(
    private db: DatabaseClient,
    private events?: TypedEventBus,
  ) {}

  async upsertBatch(items: readonly SourceUpsertItem[], options: SourceUpsertOptions = {}): Promise<SourceUpsertBatchResult> {
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
    if (items.length > maxItems) throw new Error(`Source upsert batch exceeds the ${maxItems} item bound`)
    if (items.length === 0) {
      return {
        import_run_id: '',
        dry_run: options.dryRun === true,
        outcomes: [],
        counts: { inserted: 0, unchanged: 0, versioned: 0, replaced: 0, conflict: 0, rejected: 0 },
      }
    }

    const outcomes: SourceUpsertItemResult[] = []
    for (const [index, item] of items.entries()) {
      try {
        assertSource(item.source)
        outcomes.push({
          index,
          outcome: 'rejected',
          external_id_hash: sourceHash(item.source),
          content_digest: contentDigest(item.content),
        })
      } catch (error) {
        outcomes.push({
          index,
          outcome: 'rejected',
          external_id_hash: item.source ? sourceHash({ ...item.source, external_id: item.source.external_id ?? '' }) : '',
          content_digest: contentDigest(item.content ?? ''),
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (outcomes.some((outcome) => outcome.reason)) {
      return this.finish(items[0].source?.import_run_id ?? '', options.dryRun === true, outcomes)
    }
    if (options.dryRun) {
      const preview: SourceUpsertItemResult[] = []
      for (const [index, item] of items.entries()) {
        const externalIdHash = sourceHash(item.source)
        const digest = contentDigest(item.content)
        const existing = await this.db.query<{ note_id: string; content_digest: string }>(
          `SELECT note_id, content_digest
           FROM source_identity
           WHERE tenant_id = $1
             AND archive_id IS NOT DISTINCT FROM $2
             AND namespace = $3
             AND external_id = $4
           LIMIT 1`,
          [item.source.tenant_id ?? 'default', item.source.archive_id ?? null, item.source.namespace, item.source.external_id],
        )
        if (existing.rows.length === 0) {
          preview.push({ index, outcome: 'inserted', external_id_hash: externalIdHash, content_digest: digest })
        } else if (existing.rows[0].content_digest === digest) {
          preview.push({ index, outcome: 'unchanged', note_id: existing.rows[0].note_id, external_id_hash: externalIdHash, content_digest: digest })
        } else if ((item.policy ?? 'version') === 'conflict') {
          preview.push({ index, outcome: 'conflict', note_id: existing.rows[0].note_id, external_id_hash: externalIdHash, content_digest: digest })
        } else {
          preview.push({
            index,
            outcome: item.policy === 'replace' ? 'replaced' : 'versioned',
            note_id: existing.rows[0].note_id,
            external_id_hash: externalIdHash,
            content_digest: digest,
          })
        }
      }
      return this.finish(items[0].source.import_run_id, true, preview)
    }

    await this.db.transaction(async (tx) => {
      for (const [index, item] of items.entries()) {
        const externalIdHash = sourceHash(item.source)
        const digest = contentDigest(item.content)
        const existing = await tx.query<{ note_id: string; content_digest: string }>(
          `SELECT note_id, content_digest
           FROM source_identity
           WHERE tenant_id = $1
             AND archive_id IS NOT DISTINCT FROM $2
             AND namespace = $3
             AND external_id = $4
           LIMIT 1`,
          [item.source.tenant_id ?? 'default', item.source.archive_id ?? null, item.source.namespace, item.source.external_id],
        )

        if (existing.rows.length === 0) {
          const noteId = item.source.caller_stable_id ?? generateId()
          await insertNote(tx, item, noteId, digest)
          await tx.query(
            `INSERT INTO source_identity
              (id, tenant_id, archive_id, namespace, external_id, external_id_hash,
               source_schema_version, content_digest, import_run_id, caller_stable_id, note_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              generateId(),
              item.source.tenant_id ?? 'default',
              item.source.archive_id ?? null,
              item.source.namespace,
              item.source.external_id,
              externalIdHash,
              item.source.source_schema_version,
              digest,
              item.source.import_run_id,
              item.source.caller_stable_id ?? null,
              noteId,
            ],
          )
          outcomes[index] = { index, outcome: 'inserted', note_id: noteId, external_id_hash: externalIdHash, content_digest: digest }
          continue
        }

        const row = existing.rows[0]
        if (row.content_digest === digest) {
          outcomes[index] = { index, outcome: 'unchanged', note_id: row.note_id, external_id_hash: externalIdHash, content_digest: digest }
          continue
        }

        const policy = item.policy ?? 'version'
        if (policy === 'conflict') {
          outcomes[index] = { index, outcome: 'conflict', note_id: row.note_id, external_id_hash: externalIdHash, content_digest: digest }
          continue
        }

        const outcome = policy === 'replace' ? 'replaced' : 'versioned'
        await updateNote(tx, item, row.note_id, outcome)
        await tx.query(
          `UPDATE source_identity
           SET source_schema_version = $1, content_digest = $2, import_run_id = $3, updated_at = now()
           WHERE note_id = $4
             AND tenant_id = $5
             AND archive_id IS NOT DISTINCT FROM $6
             AND namespace = $7
             AND external_id = $8`,
          [
            item.source.source_schema_version,
            digest,
            item.source.import_run_id,
            row.note_id,
            item.source.tenant_id ?? 'default',
            item.source.archive_id ?? null,
            item.source.namespace,
            item.source.external_id,
          ],
        )
        outcomes[index] = { index, outcome, note_id: row.note_id, external_id_hash: externalIdHash, content_digest: digest }
      }

      if (hasMaterialChange(outcomes)) {
        await tx.query(
          `INSERT INTO source_import_run (id, tenant_id, archive_id, namespace, completed_at, checkpoint, receipt)
           VALUES ($1, $2, $3, $4, now(), $5::jsonb, $6::jsonb)
           ON CONFLICT (id) DO UPDATE
             SET completed_at = EXCLUDED.completed_at,
                 checkpoint = EXCLUDED.checkpoint,
                 receipt = EXCLUDED.receipt`,
          [
            items[0].source.import_run_id,
            items[0].source.tenant_id ?? 'default',
            items[0].source.archive_id ?? null,
            items[0].source.namespace,
            JSON.stringify({ item_count: items.length }),
            JSON.stringify({ counts: countOutcomes(outcomes) }),
          ],
        )
      }
    })

    if (hasMaterialChange(outcomes)) {
      this.events?.emit('source.upserted', { importRunId: items[0].source.import_run_id, counts: countOutcomes(outcomes) })
    }
    return this.finish(items[0].source.import_run_id, false, outcomes)
  }

  private finish(importRunId: string, dryRun: boolean, outcomes: SourceUpsertItemResult[]): SourceUpsertBatchResult {
    return { import_run_id: importRunId, dry_run: dryRun, outcomes, counts: countOutcomes(outcomes) }
  }
}

function hasMaterialChange(outcomes: readonly SourceUpsertItemResult[]): boolean {
  return outcomes.some((outcome) => (
    outcome.outcome === 'inserted'
    || outcome.outcome === 'versioned'
    || outcome.outcome === 'replaced'
  ))
}

function countOutcomes(outcomes: readonly SourceUpsertItemResult[]): Record<SourceUpsertOutcome, number> {
  return {
    inserted: outcomes.filter((outcome) => outcome.outcome === 'inserted').length,
    unchanged: outcomes.filter((outcome) => outcome.outcome === 'unchanged').length,
    versioned: outcomes.filter((outcome) => outcome.outcome === 'versioned').length,
    replaced: outcomes.filter((outcome) => outcome.outcome === 'replaced').length,
    conflict: outcomes.filter((outcome) => outcome.outcome === 'conflict').length,
    rejected: outcomes.filter((outcome) => outcome.outcome === 'rejected').length,
  }
}
