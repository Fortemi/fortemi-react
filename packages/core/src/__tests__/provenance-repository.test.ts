import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { ProvenanceRepository } from '../repositories/provenance-repository.js'

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

describe('ProvenanceRepository', () => {
  let db: PGlite
  let repo: ProvenanceRepository

  beforeEach(async () => {
    db = await setupDb()
    repo = new ProvenanceRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('records provenance with attributes and reads it for an entity', async () => {
    const edge = await repo.recordProvenance('note', 'note-1', {
      activity: 'inducted',
      agent: 'research-corpus',
      startedAt: '2026-01-25T02:36:43-05:00',
      endedAt: '2026-01-25T02:37:43-05:00',
      attributes: { ref_id: 'REF-062', source: 'section9/research-papers' },
    })

    expect(edge.id).toBeTruthy()
    expect(edge.entity_type).toBe('note')
    expect(edge.entity_id).toBe('note-1')

    const edges = await repo.forEntity('note', 'note-1')
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({
      id: edge.id,
      activity: 'inducted',
      agent: 'research-corpus',
      attributes: { ref_id: 'REF-062', source: 'section9/research-papers' },
    })
  })

  it('orders provenance by started_at and scopes by entity type', async () => {
    await repo.recordProvenance('note', 'same-id', {
      activity: 'frontmatter_backfilled',
      agent: 'codex',
      startedAt: '2026-05-23T18:31:05-04:00',
    })
    await repo.recordProvenance('note', 'same-id', {
      activity: 'inducted',
      agent: 'research-corpus',
      startedAt: '2026-01-25T03:11:13-05:00',
    })
    await repo.recordProvenance('collection', 'same-id', {
      activity: 'inducted',
      agent: 'research-corpus',
      startedAt: '2026-01-25T02:36:43-05:00',
    })

    const edges = await repo.forEntity('note', 'same-id')
    expect(edges.map((edge) => edge.activity)).toEqual(['inducted', 'frontmatter_backfilled'])
  })
})
