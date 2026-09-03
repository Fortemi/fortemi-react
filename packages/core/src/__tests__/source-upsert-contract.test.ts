import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance } from '../db.js'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import {
  SourceUpsertRepository,
  type SourceUpsertRequest,
  type SourceUpsertResponse,
} from '../index.js'
import { MemoryRecordStore } from '../records/memory-record-store.js'
import { upsertRecordStoreRequest } from '../records/source-upsert.js'

interface FixtureCase {
  id: string
  request?: Partial<SourceUpsertRequest>
  repeat?: string
  expected: {
    batch: SourceUpsertResponse['outcome']
    items: Array<SourceUpsertResponse['items'][number]['outcome']>
    material_changes: number
    reason_code?: string
  }
}

interface Fixture {
  contract_version: string
  scope: { tenant_id: string; memory: string }
  source: Pick<SourceUpsertRequest, 'source_namespace' | 'source_schema_version'> & { source_id?: string }
  cases: FixtureCase[]
}

const fixture = JSON.parse(readFileSync(new URL(
  '../../schemas/source-note-upsert/v1.conformance.json',
  import.meta.url,
), 'utf8')) as Fixture

function requestFor(fixtureCase: FixtureCase, prior: Map<string, SourceUpsertRequest>): SourceUpsertRequest {
  if (fixtureCase.repeat) return structuredClone(prior.get(fixtureCase.repeat)!)
  return { ...fixture.source, ...fixtureCase.request } as SourceUpsertRequest
}

function assertCase(response: SourceUpsertResponse, fixtureCase: FixtureCase): void {
  expect(response.contract_version).toBe(fixture.contract_version)
  expect(response.outcome, fixtureCase.id).toBe(fixtureCase.expected.batch)
  expect(response.items.map((item) => item.outcome), fixtureCase.id).toEqual(fixtureCase.expected.items)
  const persistedChanges = response.outcome === 'committed'
    ? response.counts.inserted + response.counts.versioned + response.counts.replaced
    : 0
  expect(persistedChanges, fixtureCase.id)
    .toBe(fixtureCase.expected.material_changes)
  if (fixtureCase.expected.reason_code) {
    expect(response.items.every((item) => item.reason_code === fixtureCase.expected.reason_code)).toBe(true)
  }
  expect(response).not.toHaveProperty('outcomes')
}

describe('source-note-upsert contract 1.0.0', () => {
  describe('PGlite consumer', () => {
    let db: PGlite

    beforeEach(async () => {
      db = await createPGliteInstance('memory')
      await new MigrationRunner(db).apply(allMigrations)
    })

    afterEach(async () => { await db.close() })

    it('executes the authority fixture with exact replay and redacted journals', async () => {
      const repository = new SourceUpsertRepository(db)
      const prior = new Map<string, SourceUpsertRequest>()
      let replayBaseline: Record<string, string> | undefined
      for (const fixtureCase of fixture.cases) {
        const request = requestFor(fixtureCase, prior)
        prior.set(fixtureCase.id, structuredClone(request))
        const response = await repository.upsertRequest(request, {
          tenant_id: fixture.scope.tenant_id,
          archive_id: fixture.scope.memory === 'public' ? null : fixture.scope.memory,
        })
        assertCase(response, fixtureCase)
        if (fixtureCase.id === 'insert') replayBaseline = await pgliteCounts(db)
        if (fixtureCase.id === 'exact-batch-replay') expect(await pgliteCounts(db)).toEqual(replayBaseline)
      }

      const counts = await pgliteCounts(db)
      expect(Number(counts.revisions)).toBe(2)
      expect(Number(counts.jobs)).toBe(0)
      expect(Number(counts.blobs)).toBe(0)
      const journals = await db.query<{ text: string }>(
        `SELECT receipt::text AS text FROM source_import_batch
         UNION ALL SELECT receipt::text AS text FROM source_import_run`,
      )
      expect(journals.rows.every(({ text }) => !text.includes('fixture-a') && !text.includes('alpha replacement'))).toBe(true)
    })

    it('rolls back a batch-level stable-id collision and isolates memory scope', async () => {
      const repository = new SourceUpsertRepository(db)
      const collision: SourceUpsertRequest = {
        ...fixture.source,
        import_run_id: 'failure-run',
        batch_id: 'failure-batch',
        items: [
          { external_id: 'failure-a', content: 'first', caller_stable_id: '018f05a7-cafe-7def-8000-000000000099' },
          { external_id: 'failure-b', content: 'second', caller_stable_id: '018f05a7-cafe-7def-8000-000000000099' },
        ],
      }
      const rejected = await repository.upsertRequest(collision, { tenant_id: fixture.scope.tenant_id })
      expect(rejected).toMatchObject({ outcome: 'rejected', counts: { rejected: 2 } })
      expect(await pgliteCounts(db)).toMatchObject({ notes: 0, batches: 0 })

      const base = { ...fixture.source, import_run_id: 'memory-public', batch_id: 'memory-public', items: [{ external_id: 'same', content: 'public' }] }
      const other = { ...base, import_run_id: 'memory-other', batch_id: 'memory-other', items: [{ external_id: 'same', content: 'other' }] }
      expect((await repository.upsertRequest(base, { tenant_id: fixture.scope.tenant_id })).outcome).toBe('committed')
      expect((await repository.upsertRequest(other, { tenant_id: fixture.scope.tenant_id, archive_id: 'archive-other' })).outcome).toBe('committed')
      expect((await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM source_identity')).rows[0].count).toBe('2')
    })
  })

  it('executes the same fixture in the canonical RecordStore without replay journal growth', async () => {
    const store = new MemoryRecordStore()
    const prior = new Map<string, SourceUpsertRequest>()
    let replayHead = 0
    for (const fixtureCase of fixture.cases) {
      const request = requestFor(fixtureCase, prior)
      prior.set(fixtureCase.id, structuredClone(request))
      const response = await upsertRecordStoreRequest(store, request, {
        tenant_id: fixture.scope.tenant_id,
        archive_id: fixture.scope.memory === 'public' ? null : fixture.scope.memory,
      })
      assertCase(response, fixtureCase)
      if (fixtureCase.id === 'insert') replayHead = await store.headSeq()
      if (fixtureCase.id === 'exact-batch-replay') expect(await store.headSeq()).toBe(replayHead)
    }
    expect(await store.list('note')).toHaveLength(1)
    expect(await store.list('note_revision')).toHaveLength(2)
    expect(await store.list('source_import_batch')).toHaveLength(4)
    const receipts = await store.list('source_import_batch')
    expect(JSON.stringify(receipts)).not.toContain('fixture-a')
    expect(JSON.stringify(receipts)).not.toContain('alpha replacement')
  })
})

async function pgliteCounts(db: PGlite): Promise<Record<string, string>> {
  return (await db.query<Record<string, string>>(
    `SELECT
      (SELECT COUNT(*) FROM note) AS notes,
      (SELECT COUNT(*) FROM note_revision) AS revisions,
      (SELECT COUNT(*) FROM source_identity) AS identities,
      (SELECT COUNT(*) FROM source_import_run) AS runs,
      (SELECT COUNT(*) FROM source_import_batch) AS batches,
      (SELECT COUNT(*) FROM job_queue) AS jobs,
      (SELECT COUNT(*) FROM attachment_blob) AS blobs`,
  )).rows[0]
}
