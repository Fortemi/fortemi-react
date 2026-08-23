import type { DatabaseClient, QueryExecutor } from '../storage-backend.js'
import { computeHash } from '../hash.js'
import { generateId } from '../uuid.js'
import type { TypedEventBus } from '../event-bus.js'

export interface PurgeSelector {
  tenant_id?: string
  archive_id?: string | null
  note_ids?: readonly string[]
  source?: {
    namespace: string
    external_id?: string
  }
}

export interface PurgeCounts {
  notes: number
  revisions: number
  links: number
  tags: number
  embeddings: number
  attachments: number
  blobs: number
  graph_edges: number
  provenance_edges: number
  source_identities: number
}

export interface DeletionReceipt {
  id: string
  operation_key: string
  tenant_id: string
  archive_id: string | null
  selector_hash: string
  outcome: 'completed'
  counts: PurgeCounts
  completed_at: string
  policy: {
    authority: 'fortemi#1092'
    mode: 'terminal-purge'
    receipt_contains_content: false
  }
}

export interface PurgePreview {
  selector_hash: string
  counts: PurgeCounts
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

function selectorHash(selector: PurgeSelector): string {
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

function buildSelectorWhere(selector: PurgeSelector, startIdx: number): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  let idx = startIdx

  if (selector.note_ids?.length) {
    clauses.push(`n.id = ANY($${idx++})`)
    params.push([...selector.note_ids])
  }
  if (selector.tenant_id !== undefined || selector.archive_id !== undefined || selector.source) {
    clauses.push(`EXISTS (
      SELECT 1 FROM source_identity si
      WHERE si.note_id = n.id
        AND si.tenant_id = $${idx++}
        AND si.archive_id IS NOT DISTINCT FROM $${idx++}
        ${selector.source ? `AND si.namespace = $${idx++}` : ''}
        ${selector.source?.external_id ? `AND si.external_id = $${idx++}` : ''}
    )`)
    params.push(selector.tenant_id ?? 'default', selector.archive_id ?? null)
    if (selector.source) params.push(selector.source.namespace)
    if (selector.source?.external_id) params.push(selector.source.external_id)
  }

  if (clauses.length === 0) throw new Error('Purge selector must target note_ids or source identity')
  return { sql: clauses.join(' AND '), params }
}

async function selectedNoteIds(db: QueryExecutor, selector: PurgeSelector): Promise<string[]> {
  const where = buildSelectorWhere(selector, 1)
  const result = await db.query<{ id: string }>(
    `SELECT n.id FROM note n WHERE ${where.sql} ORDER BY n.id`,
    where.params,
  )
  return result.rows.map((row) => row.id)
}

export class LifecyclePurgeRepository {
  constructor(
    private db: DatabaseClient,
    private events?: TypedEventBus,
  ) {}

  async preview(selector: PurgeSelector): Promise<PurgePreview> {
    const noteIds = await selectedNoteIds(this.db, selector)
    return { selector_hash: selectorHash(selector), counts: await this.count(noteIds) }
  }

  async purge(selector: PurgeSelector, operationKey: string): Promise<DeletionReceipt> {
    const existing = await this.db.query<{
      id: string
      operation_key: string
      tenant_id: string
      archive_id: string | null
      selector_hash: string
      outcome: 'completed'
      counts: PurgeCounts
      completed_at: string
      policy: DeletionReceipt['policy']
    }>(
      `SELECT id, operation_key, tenant_id, archive_id, selector_hash, outcome, counts, completed_at, policy
       FROM deletion_receipt
       WHERE operation_key = $1`,
      [operationKey],
    )
    if (existing.rows[0]) return existing.rows[0]

    const hash = selectorHash(selector)
    let receipt: DeletionReceipt | undefined
    await this.db.transaction(async (tx) => {
      const noteIds = await selectedNoteIds(tx, selector)
      const counts = await this.count(noteIds, tx)
      await this.deleteSelected(tx, noteIds)
      receipt = {
        id: generateId(),
        operation_key: operationKey,
        tenant_id: selector.tenant_id ?? 'default',
        archive_id: selector.archive_id ?? null,
        selector_hash: hash,
        outcome: 'completed',
        counts,
        completed_at: new Date().toISOString(),
        policy: {
          authority: 'fortemi#1092',
          mode: 'terminal-purge',
          receipt_contains_content: false,
        },
      }
      await tx.query(
        `INSERT INTO deletion_receipt
          (id, operation_key, tenant_id, archive_id, selector_hash, outcome, counts, completed_at, policy)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6::jsonb, $7, $8::jsonb)`,
        [
          receipt.id,
          receipt.operation_key,
          receipt.tenant_id,
          receipt.archive_id,
          receipt.selector_hash,
          JSON.stringify(receipt.counts),
          receipt.completed_at,
          JSON.stringify(receipt.policy),
        ],
      )
    })
    const completedReceipt = receipt
    if (!completedReceipt) throw new Error('Purge transaction did not produce a receipt')
    this.events?.emit('purge.completed', { receiptId: completedReceipt.id, counts: completedReceipt.counts as unknown as Record<string, number> })
    return completedReceipt
  }

  private async count(noteIds: readonly string[], db: QueryExecutor = this.db): Promise<PurgeCounts> {
    const counts = zeroCounts()
    if (noteIds.length === 0) return counts
    const params = [noteIds]
    const rows = await Promise.all([
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM note WHERE id = ANY($1)', params),
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM note_revision WHERE note_id = ANY($1)', params),
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM link WHERE source_note_id = ANY($1) OR target_note_id = ANY($1)', params),
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM note_tag WHERE note_id = ANY($1)', params),
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM embedding WHERE note_id = ANY($1)', params),
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM attachment WHERE note_id = ANY($1)', params),
      db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM attachment_blob ab
         WHERE EXISTS (SELECT 1 FROM attachment a WHERE a.blob_id = ab.id AND a.note_id = ANY($1))`,
        params,
      ),
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM graph_edge_artifact WHERE from_note_id = ANY($1) OR to_note_id = ANY($1)', params),
      db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM provenance_edge
         WHERE (entity_type = 'note' AND entity_id = ANY($1))
            OR (attributes ->> 'note_id') = ANY($1)`,
        params,
      ),
      db.query<{ count: string }>('SELECT COUNT(*) AS count FROM source_identity WHERE note_id = ANY($1)', params),
    ])
    const values = rows.map((row) => Number.parseInt(row.rows[0]?.count ?? '0', 10))
    ;[
      counts.notes,
      counts.revisions,
      counts.links,
      counts.tags,
      counts.embeddings,
      counts.attachments,
      counts.blobs,
      counts.graph_edges,
      counts.provenance_edges,
      counts.source_identities,
    ] = values
    return counts
  }

  private async deleteSelected(tx: QueryExecutor, noteIds: readonly string[]): Promise<void> {
    if (noteIds.length === 0) return
    const params = [noteIds]
    await tx.query('DELETE FROM community_assignment WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM graph_edge_artifact WHERE from_note_id = ANY($1) OR to_note_id = ANY($1)', params)
    await tx.query('DELETE FROM embedding_set_member WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM embedding WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM attachment_embedding WHERE attachment_id IN (SELECT id FROM attachment WHERE note_id = ANY($1))', params)
    await tx.query('DELETE FROM attachment WHERE note_id = ANY($1)', params)
    await tx.query(
      `DELETE FROM attachment_blob ab
       WHERE NOT EXISTS (SELECT 1 FROM attachment a WHERE a.blob_id = ab.id)`,
    )
    await tx.query('DELETE FROM source_identity WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM provenance_edge WHERE (entity_type = $2 AND entity_id = ANY($1)) OR (attributes ->> $3) = ANY($1)', [noteIds, 'note', 'note_id'])
    await tx.query('DELETE FROM job_queue WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM collection_note WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM note_tag WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM link WHERE source_note_id = ANY($1) OR target_note_id = ANY($1)', params)
    await tx.query('DELETE FROM note_revision WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM note_revised_current WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM note_original WHERE note_id = ANY($1)', params)
    await tx.query('DELETE FROM shard_field_presence WHERE component = $2 AND record_id = ANY($1)', [noteIds, 'notes'])
    await tx.query('DELETE FROM note WHERE id = ANY($1)', params)
  }
}
