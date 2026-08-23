import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { SourceUpsertRepository } from '../repositories/source-upsert-repository.js'
import { SearchRepository } from '../repositories/search-repository.js'
import { LifecyclePurgeRepository } from '../repositories/lifecycle-purge-repository.js'
import { MemoryRecordStore } from '../records/memory-record-store.js'
import { exportShardFromRecordsWithReport, previewRecordStorePurge, purgeRecordStoreGraph, upsertRecordStoreSources } from '../records/index.js'
import { TypedEventBus } from '../event-bus.js'
import { exportShardWithReport } from '../shard/shard-export.js'

const vector384 = `[${new Array(384).fill(0).map((_, index) => index === 0 ? 1 : 0).join(',')}]`
const queryEmbedding = new Array(384).fill(0).map((_, index) => index === 0 ? 1 : 0)

describe('source-addressed upsert, metadata locators, and purge receipts', () => {
  let db: PGlite
  let upsert: SourceUpsertRepository

  beforeEach(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
    upsert = new SourceUpsertRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('atomically upserts by tenant/archive/source key and replays without duplicate operational state', async () => {
    const item = {
      source: {
        tenant_id: 'tenant-a',
        archive_id: 'archive-a',
        namespace: 'aiwg',
        external_id: 'raw/provider/path.md',
        source_schema_version: 'aiwg.v2',
        import_run_id: 'run-1',
        caller_stable_id: 'note-source-a',
      },
      title: 'Provider note',
      content: 'provider model role event sensitivity',
      metadata: {
        provider: 'openai',
        model: 'gpt-5',
        role: 'reasoning',
        event_kind: 'message',
        sensitivity: 'internal',
      },
    }

    const events = new TypedEventBus()
    let upsertEvents = 0
    events.on('source.upserted', () => { upsertEvents++ })
    upsert = new SourceUpsertRepository(db, events)

    const first = await upsert.upsertBatch([item])
    const replay = await upsert.upsertBatch([item])
    const changed = await upsert.upsertBatch([{ ...item, content: 'changed content', policy: 'version' }])

    expect(first.counts.inserted).toBe(1)
    expect(replay.counts.unchanged).toBe(1)
    expect(changed.counts.versioned).toBe(1)

    const counts = await db.query<{
      notes: string
      originals: string
      current: string
      identities: string
      import_runs: string
      jobs: string
      revisions: string
    }>(
      `SELECT
        (SELECT COUNT(*) FROM note) AS notes,
        (SELECT COUNT(*) FROM note_original) AS originals,
        (SELECT COUNT(*) FROM note_revised_current) AS current,
        (SELECT COUNT(*) FROM source_identity) AS identities,
        (SELECT COUNT(*) FROM source_import_run) AS import_runs,
        (SELECT COUNT(*) FROM job_queue) AS jobs,
        (SELECT COUNT(*) FROM note_revision) AS revisions`,
    )
    expect(Object.fromEntries(Object.entries(counts.rows[0]).map(([key, value]) => [key, Number(value)]))).toMatchObject({
      notes: 1,
      originals: 1,
      current: 1,
      identities: 1,
      import_runs: 1,
      jobs: 0,
      revisions: 1,
    })
    expect(upsertEvents).toBe(2)

    await expect(upsert.upsertBatch([{ ...item, source: { ...item.source, tenant_id: '', external_id: '' } }], { dryRun: true }))
      .resolves.toMatchObject({ counts: { rejected: 1 } })
    const afterRejectedDryRun = await db.query<{ notes: string }>('SELECT COUNT(*) AS notes FROM note')
    expect(Number(afterRejectedDryRun.rows[0].notes)).toBe(1)
  })

  it('applies metadata and source scope before text, semantic, and hybrid ranking and returns safe locators', async () => {
    const matching = await upsert.upsertBatch([{
      source: {
        tenant_id: 'tenant-a',
        archive_id: 'archive-a',
        namespace: 'aiwg',
        external_id: 'secret/raw-key',
        source_schema_version: 'aiwg.v2',
        import_run_id: 'run-filter',
      },
      title: 'Needle',
      content: 'needle shared semantic body',
      metadata: { provider: 'openai', model: 'gpt-5', role: 'reasoning', event_kind: 'message', sensitivity: 'internal' },
    }])
    await upsert.upsertBatch([{
      source: {
        tenant_id: 'tenant-b',
        archive_id: 'archive-a',
        namespace: 'aiwg',
        external_id: 'other/raw-key',
        source_schema_version: 'aiwg.v2',
        import_run_id: 'run-filter',
      },
      title: 'Needle other tenant',
      content: 'needle shared semantic body',
      metadata: { provider: 'anthropic', model: 'claude', role: 'reasoning', event_kind: 'message', sensitivity: 'internal' },
    }])

    const noteId = matching.outcomes[0].note_id!
    await db.query(
      `INSERT INTO embedding_set (id, model_name, dimensions) VALUES ('set-a', 'test', 384)`,
    )
    await db.query(
      `INSERT INTO embedding (id, note_id, embedding_set_id, vector) VALUES ('emb-a', $1, 'set-a', $2::vector)`,
      [noteId, vector384],
    )

    const options = {
      tenant_id: 'tenant-a',
      archive_id: 'archive-a',
      metadataPredicates: [
        { path: 'provider', op: 'eq', value: 'openai' },
        { path: 'model', op: 'in', value: ['gpt-5'] },
        { path: 'sensitivity', op: 'exists' },
      ],
    } as const

    const search = new SearchRepository(db, true)
    const text = await search.search('needle', { ...options, mode: 'text' })
    const semantic = await search.search('', { ...options, mode: 'semantic' }, queryEmbedding)
    const hybrid = await search.search('needle', { ...options, mode: 'hybrid' }, queryEmbedding)

    for (const result of [text, semantic, hybrid]) {
      expect(result.results.map((entry) => entry.id)).toEqual([noteId])
      expect(result.results[0].locators?.[0]).toMatchObject({
        note_id: noteId,
        source: {
          namespace: 'aiwg',
          import_run_id: 'run-filter',
          schema_version: 'aiwg.v2',
        },
        metadata_paths: ['provider', 'model', 'sensitivity'],
      })
      expect(JSON.stringify(result.results[0].locators)).not.toContain('secret/raw-key')
    }

    await expect(search.search('needle', {
      metadataPredicates: [{ path: 'unindexed' as never, op: 'eq', value: 'x' }],
    })).rejects.toThrow(/Unsupported metadata predicate path/)
  })

  it('purges graph/search state atomically and replays one content-free deletion receipt', async () => {
    const seeded = await upsert.upsertBatch([{
      source: {
        tenant_id: 'tenant-a',
        archive_id: null,
        namespace: 'aiwg',
        external_id: 'purge/raw-key',
        source_schema_version: 'aiwg.v2',
        import_run_id: 'run-purge',
      },
      title: 'Purge me',
      content: 'purge target content',
      metadata: { provider: 'openai' },
    }])
    const noteId = seeded.outcomes[0].note_id!
    await db.query(`INSERT INTO embedding_set (id, model_name, dimensions) VALUES ('set-purge', 'test', 384)`)
    await db.query(`INSERT INTO embedding (id, note_id, embedding_set_id, vector) VALUES ('emb-purge', $1, 'set-purge', $2::vector)`, [noteId, vector384])
    await db.query(`INSERT INTO graph_source (id, name, kind, input_hash, freshness_json) VALUES ('graph-a', 'Graph', 'similarity', 'hash', '{}')`)
    await db.query(
      `INSERT INTO graph_edge_artifact (graph_source_id, from_note_id, to_note_id, weight, kind)
       VALUES ('graph-a', $1, $1, 1, 'self')`,
      [noteId],
    )

    const lifecycle = new LifecyclePurgeRepository(db)
    const selector = { tenant_id: 'tenant-a', source: { namespace: 'aiwg' } }
    const preview = await lifecycle.preview(selector)
    const receipt = await lifecycle.purge(selector, 'purge-op-1')
    const replay = await lifecycle.purge(selector, 'purge-op-1')

    expect(receipt.counts).toMatchObject(preview.counts)
    expect(replay.id).toBe(receipt.id)
    expect(JSON.stringify(receipt)).not.toContain('purge/raw-key')
    expect(JSON.stringify(receipt)).not.toContain('purge target content')

    const search = await new SearchRepository(db, true).search('purge', { mode: 'text' })
    expect(search.results).toEqual([])
    const graphEdges = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM graph_edge_artifact')
    expect(Number(graphEdges.rows[0].count)).toBe(0)
  })

  it('RecordStore implements matching source upsert and purge receipt outcome classes', async () => {
    const store = new MemoryRecordStore()
    const item = {
      source: {
        tenant_id: 'tenant-a',
        archive_id: null,
        namespace: 'aiwg',
        external_id: 'record/raw-key',
        source_schema_version: 'aiwg.v2',
        import_run_id: 'record-run',
      },
      title: 'Record note',
      content: 'record content',
      metadata: { provider: 'openai' },
    }
    const first = await upsertRecordStoreSources(store, [item])
    const headAfterFirst = await store.headSeq()
    const replay = await upsertRecordStoreSources(store, [item])
    const headAfterReplay = await store.headSeq()
    expect(first.counts.inserted).toBe(1)
    expect(replay.counts.unchanged).toBe(1)
    expect(headAfterReplay).toBe(headAfterFirst)

    const selector = { tenant_id: 'tenant-a', source: { namespace: 'aiwg' } }
    const preview = await previewRecordStorePurge(store, selector)
    const receipt = await purgeRecordStoreGraph(store, selector, 'record-purge-1')
    const replayReceipt = await purgeRecordStoreGraph(store, selector, 'record-purge-1')
    expect(receipt.counts).toMatchObject(preview.counts)
    expect(replayReceipt.id).toBe(receipt.id)
    expect(await store.list('note')).toEqual([])
    expect(JSON.stringify(receipt)).not.toContain('record/raw-key')
    await store.close()
  })

  it('reports source identity loss during profile export without leaking raw source keys', async () => {
    const item = {
      source: {
        tenant_id: 'tenant-a',
        archive_id: null,
        namespace: 'aiwg',
        external_id: 'raw/export-secret-key',
        source_schema_version: 'aiwg.v2',
        import_run_id: 'export-run',
      },
      title: 'Export source identity',
      content: 'export source identity content',
      metadata: { provider: 'openai' },
    }

    await upsert.upsertBatch([item])
    const pgliteExport = await exportShardWithReport(db, { profile: 'core-v1' })
    expect(pgliteExport.success).toBe(true)
    expect(pgliteExport.capability_report.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source-identity-outside-profile',
        count: 1,
        field_path: 'source_identity',
        action: 'omit',
      }),
    ]))
    expect(JSON.stringify(pgliteExport.capability_report.losses)).not.toContain('raw/export-secret-key')

    const store = new MemoryRecordStore()
    await upsertRecordStoreSources(store, [item])
    const recordExport = await exportShardFromRecordsWithReport(store, { profile: 'record-v1' })
    expect(recordExport.success).toBe(true)
    expect(recordExport.capability_report.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source-identity-outside-profile',
        count: 1,
        field_path: 'source_identity',
        action: 'omit',
      }),
    ]))
    expect(JSON.stringify(recordExport.capability_report.losses)).not.toContain('raw/export-secret-key')
    await store.close()
  })
})
