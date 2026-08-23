import { computeHash } from '../hash.js'
import { generateId } from '../uuid.js'
import type {
  NoteOriginalRecord,
  NoteRecord0,
  NoteRevisedCurrentRecord,
  RecordMutation,
  RecordStore,
  SourceIdentityRecord,
  SourceImportRunRecord,
} from './types.js'
import type {
  SourceIdentityInput,
  SourceUpsertBatchResult,
  SourceUpsertItem,
  SourceUpsertItemResult,
  SourceUpsertOutcome,
  SourceUpsertOptions,
} from '../repositories/source-upsert-repository.js'

function now(): string {
  return new Date().toISOString()
}

function contentDigest(content: string): string {
  return computeHash(new TextEncoder().encode(content))
}

function sourceHash(source: SourceIdentityInput): string {
  return computeHash(new TextEncoder().encode([
    source.tenant_id ?? 'default',
    source.archive_id ?? '',
    source.namespace,
    source.external_id,
  ].join('\0')))
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

async function findSource(store: RecordStore, source: SourceIdentityInput): Promise<SourceIdentityRecord | null> {
  const identities = await store.list('source_identity')
  return identities.find((identity) => (
    identity.tenant_id === (source.tenant_id ?? 'default')
    && identity.archive_id === (source.archive_id ?? null)
    && identity.namespace === source.namespace
    && identity.external_id === source.external_id
  )) ?? null
}

export async function upsertRecordStoreSources(
  store: RecordStore,
  items: readonly SourceUpsertItem[],
  options: SourceUpsertOptions = {},
): Promise<SourceUpsertBatchResult> {
  const maxItems = options.maxItems ?? 500
  if (items.length > maxItems) throw new Error(`Source upsert batch exceeds the ${maxItems} item bound`)
  if (!store.applyBatch) throw new Error('RecordStore source upsert requires atomic applyBatch() support')
  if (items.length === 0) {
    return {
      import_run_id: '',
      dry_run: options.dryRun === true,
      outcomes: [],
      counts: { inserted: 0, unchanged: 0, versioned: 0, replaced: 0, conflict: 0, rejected: 0 },
    }
  }

  const outcomes: SourceUpsertItemResult[] = []
  const mutations: RecordMutation[] = []
  const stamp = now()

  for (const [index, item] of items.entries()) {
    const external_id_hash = sourceHash(item.source)
    const content_digest = contentDigest(item.content)
    const existing = await findSource(store, item.source)
    if (!existing) {
      const noteId = item.source.caller_stable_id ?? generateId()
      outcomes.push({ index, outcome: 'inserted', note_id: noteId, external_id_hash, content_digest })
      if (!options.dryRun) {
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
        const original: NoteOriginalRecord = {
          id: generateId(),
          note_id: noteId,
          content: item.content,
          content_hash: content_digest,
          created_at: stamp,
        }
        const current: NoteRevisedCurrentRecord = {
          id: noteId,
          content: item.content,
          ai_metadata: item.metadata ?? null,
          generation_count: 0,
          model: null,
          is_user_edited: false,
          updated_at: stamp,
        }
        const identity: SourceIdentityRecord = {
          id: generateId(),
          tenant_id: item.source.tenant_id ?? 'default',
          archive_id: item.source.archive_id ?? null,
          namespace: item.source.namespace,
          external_id: item.source.external_id,
          external_id_hash,
          source_schema_version: item.source.source_schema_version,
          content_digest,
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
          { op: 'put', collection: 'source_identity', record: identity },
        )
      }
      continue
    }

    if (existing.content_digest === content_digest) {
      outcomes.push({ index, outcome: 'unchanged', note_id: existing.note_id, external_id_hash, content_digest })
      continue
    }
    const policy = item.policy ?? 'version'
    if (policy === 'conflict') {
      outcomes.push({ index, outcome: 'conflict', note_id: existing.note_id, external_id_hash, content_digest })
      continue
    }
    const note = await store.get('note', existing.note_id)
    const current = await store.get('note_revised_current', existing.note_id)
    if (!note || !current) {
      outcomes.push({ index, outcome: 'rejected', note_id: existing.note_id, external_id_hash, content_digest, reason: 'source identity points to a missing note' })
      continue
    }
    const outcome = policy === 'replace' ? 'replaced' : 'versioned'
    outcomes.push({ index, outcome, note_id: existing.note_id, external_id_hash, content_digest })
    if (!options.dryRun) {
      mutations.push(
        {
          op: 'put',
          collection: 'note',
          record: {
            ...note,
            title: item.title ?? null,
            archive_id: item.source.archive_id ?? null,
            format: item.format ?? 'markdown',
            visibility: item.visibility ?? 'private',
            deleted_at: null,
            updated_at: stamp,
          },
        },
        {
          op: 'put',
          collection: 'note_revised_current',
          record: { ...current, content: item.content, ai_metadata: item.metadata ?? null, is_user_edited: false, updated_at: stamp },
        },
        {
          op: 'put',
          collection: 'source_identity',
          record: { ...existing, source_schema_version: item.source.source_schema_version, content_digest, import_run_id: item.source.import_run_id, updated_at: stamp },
        },
      )
    }
  }

  if (!options.dryRun && hasMaterialChange(outcomes)) {
    const run: SourceImportRunRecord = {
      id: items[0].source.import_run_id,
      tenant_id: items[0].source.tenant_id ?? 'default',
      archive_id: items[0].source.archive_id ?? null,
      namespace: items[0].source.namespace,
      started_at: stamp,
      completed_at: stamp,
      checkpoint: { item_count: items.length },
      receipt: { counts: countOutcomes(outcomes) },
    }
    mutations.push({ op: 'put', collection: 'source_import_run', record: run })
    await store.applyBatch(mutations)
  }

  return {
    import_run_id: items[0].source.import_run_id,
    dry_run: options.dryRun === true,
    outcomes,
    counts: countOutcomes(outcomes),
  }
}

function hasMaterialChange(outcomes: readonly SourceUpsertItemResult[]): boolean {
  return outcomes.some((outcome) => (
    outcome.outcome === 'inserted'
    || outcome.outcome === 'versioned'
    || outcome.outcome === 'replaced'
  ))
}
