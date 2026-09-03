import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MemoryBlobStore,
  MigrationRunner,
  allMigrations,
  createPGliteInstance,
} from '@fortemi/core'
import { PAPERS } from './corpus.js'
import { seedWorkbench } from './seed.js'

describe('seedWorkbench provenance', () => {
  let db: Awaited<ReturnType<typeof createPGliteInstance>>

  beforeEach(async () => {
    db = await createPGliteInstance('memory')
    await new MigrationRunner(db).apply(allMigrations)
  })

  afterEach(async () => {
    await db.close()
  })

  it('persists one source edge per paper and one derivation edge per citation', async () => {
    const seeded = await seedWorkbench(db, new MemoryBlobStore())
    const rows = (await db.query<{
      entity_id: string
      activity: string
      agent: string
      attributes: Record<string, unknown>
    }>(
      `SELECT entity_id, activity, agent, attributes
       FROM provenance_edge
       ORDER BY started_at, id`,
    )).rows
    const citationCount = PAPERS.reduce((count, paper) => count + paper.cites.length, 0)

    expect(rows).toHaveLength(PAPERS.length + citationCount)

    for (const paper of PAPERS) {
      const noteId = seeded.idByKey.get(paper.key)
      const source = rows.find((row) =>
        row.entity_id === noteId && row.attributes.paper_key === paper.key,
      )
      expect(source).toMatchObject({
        activity: paper.provenance.activity,
        agent: paper.provenance.agent,
        attributes: {
          'prov:entity': paper.provenance.entity,
          'prov:wasGeneratedBy': paper.provenance.activity,
          'prov:wasAssociatedWith': paper.provenance.agent,
          'prov:wasDerivedFrom': paper.provenance.derivedFrom,
          'prov:location': paper.provenance.location,
          confidence: paper.provenance.confidence,
        },
      })
    }

    const citationRows = rows.filter((row) => row.attributes.relation === 'cites')
    expect(citationRows).toHaveLength(citationCount)
    expect(citationRows.every((row) =>
      row.activity === 'prov:Derive' &&
      row.agent === 'demo:citation-linker' &&
      typeof row.attributes['prov:wasDerivedFrom'] === 'string',
    )).toBe(true)
  })
})
