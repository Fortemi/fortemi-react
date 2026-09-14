import { afterEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createMigratedTestDb } from './helpers/migrated-test-db.js'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { NotesRepository } from '../repositories/notes-repository.js'

describe('empty migrated test database clones', () => {
  const opened: PGlite[] = []
  async function open() {
    const db = await createMigratedTestDb()
    opened.push(db)
    return db
  }
  afterEach(async () => {
    for (const db of opened.splice(0)) await db.close()
  })

  it('retains every migration and a working vector extension', async () => {
    const db = await open()
    expect(await new MigrationRunner(db).getAppliedMigrations()).toEqual(
      allMigrations.map(({ version, name }) => ({ version, name })).sort((a, b) => a.version - b.version),
    )
    expect((await db.query<{ distance: number }>("SELECT '[1,0,0]'::vector <-> '[1,0,0]'::vector AS distance")).rows).toEqual([{ distance: 0 }])
  })

  it('does not transfer committed notes or queued jobs between live clones', async () => {
    const first = await open()
    const note = await new NotesRepository(first).create({ content: 'Owned by first clone' })
    await first.query("INSERT INTO job_queue (id, note_id, job_type) VALUES ('fixture-job', $1, 'test.fixture')", [note.id])
    const second = await open()
    expect((await second.query('SELECT * FROM note')).rows).toEqual([])
    expect((await second.query('SELECT * FROM job_queue')).rows).toEqual([])
    expect((await first.query('SELECT id FROM note')).rows).toEqual([{ id: note.id }])
  })

  it('does not transfer schema changes or share close ownership', async () => {
    const first = await open()
    await first.exec('CREATE TABLE fixture_private (value TEXT)')
    await first.close()
    opened.splice(opened.indexOf(first), 1)
    const second = await open()
    expect((await second.query("SELECT to_regclass('public.fixture_private') AS relation")).rows).toEqual([{ relation: null }])
    const note = await new NotesRepository(second).create({ content: 'Second remains writable' })
    expect((await second.query('SELECT id FROM note')).rows).toEqual([{ id: note.id }])
  })
})
