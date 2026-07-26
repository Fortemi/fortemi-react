import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import {
  MigrationRunner,
  allMigrations,
  createPGliteInstance,
  exportShardWithReport,
  unpackTarGz,
  validateCoreV1ShardArchive,
} from '../dist/index.js'

const FIXED_NOW = Date.parse('2026-07-26T16:00:00.000Z')
const root = new URL('../', import.meta.url)
const output = new URL(
  'src/__tests__/shard/fixtures/pglite-core-v1-2026.7.13.shard',
  root,
)
const verify = process.argv.includes('--verify')

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function createDatabase() {
  const db = await createPGliteInstance('memory')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

async function seed(db) {
  await db.exec(`
    INSERT INTO collection
      (id, name, description, parent_id, position, created_at, updated_at, deleted_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e701', 'Parent', NULL, NULL, 0,
       '2026-07-26T14:00:00Z', '2026-07-26T14:00:00Z', NULL),
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e702', 'Child', 'Nested collection',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e701', 1,
       '2026-07-26T14:01:00Z', '2026-07-26T14:02:00Z', NULL);

    INSERT INTO note
      (id, title, format, source, is_starred, is_archived,
       created_at, updated_at, deleted_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e711', 'Current PGlite note',
       'markdown', 'pglite-self-cell', true, false,
       '2026-07-26T14:10:00Z', '2026-07-26T14:11:00Z', NULL),
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e712', 'Current PGlite tombstone',
       'markdown', 'pglite-self-cell', false, true,
       '2026-07-26T14:12:00Z', '2026-07-26T14:14:00Z',
       '2026-07-26T14:14:00Z');

    INSERT INTO note_original (id, note_id, content, content_hash, created_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e721',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e711',
       '# Original', 'fixture-original-active', '2026-07-26T14:10:00Z'),
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e722',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e712',
       '# Deleted original', 'fixture-original-deleted', '2026-07-26T14:12:00Z');

    INSERT INTO note_revised_current
      (note_id, content, ai_metadata, generation_count, model,
       is_user_edited, updated_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e711', '# Revised',
       '{"conformance":{"producer":"@fortemi/core","profile":"core-v1","version":"2026.7.13"}}',
       1, 'fixture', false, '2026-07-26T14:11:00Z'),
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e712', NULL, NULL,
       0, NULL, false, '2026-07-26T14:14:00Z');

    INSERT INTO collection_note (collection_id, note_id, position, added_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e702',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e711', 0, '2026-07-26T14:10:30Z'),
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e701',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e712', 0, '2026-07-26T14:12:30Z');

    INSERT INTO note_tag (id, note_id, tag, created_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e731',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e711', 'portable',
       '2026-07-26T14:10:00Z'),
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e732',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e712', 'tombstone',
       '2026-07-26T14:12:00Z');

    INSERT INTO template
      (id, name, description, content, format, default_tags,
       collection_id, created_at, updated_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e741', 'Current PGlite template',
       NULL, '# Template', 'markdown', '["portable"]',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e701',
       '2026-07-26T14:20:00Z', '2026-07-26T14:21:00Z');

    INSERT INTO link
      (id, source_note_id, target_note_id, link_type, confidence,
       created_at, updated_at, deleted_at)
    VALUES
      ('018f2d2d-bc00-7cc8-8ad2-f147d6a2e751',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e711',
       '018f2d2d-bc00-7cc8-8ad2-f147d6a2e712',
       'related', NULL, '2026-07-26T14:30:00Z',
       '2026-07-26T14:31:00Z', NULL);
  `)
}

const NativeDate = Date
class FrozenDate extends NativeDate {
  constructor(...args) {
    super(...(args.length === 0 ? [FIXED_NOW] : args))
  }

  static now() {
    return FIXED_NOW
  }
}

globalThis.Date = FrozenDate
let db
try {
  db = await createDatabase()
  await seed(db)
  const exported = await exportShardWithReport(db, { profile: 'core-v1' })
  assert.equal(exported.success, true, exported.errors.join('; '))
  assert.ok(exported.archive)
  assert.equal(exported.capability_report.portable, true)
  assert.deepEqual(
    await validateCoreV1ShardArchive(unpackTarGz(exported.archive)),
    { valid: true, errors: [] },
  )

  if (verify) {
    const expected = await readFile(output)
    assert.equal(
      Buffer.compare(Buffer.from(exported.archive), expected),
      0,
      `fixture drift: expected ${digest(expected)}, got ${digest(exported.archive)}`,
    )
  } else {
    await writeFile(output, exported.archive)
  }
  process.stdout.write(`${digest(exported.archive)}  ${output.pathname}\n`)
} finally {
  await db?.close()
  globalThis.Date = NativeDate
}
