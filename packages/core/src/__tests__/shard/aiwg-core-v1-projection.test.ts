import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import type { AiwgFortemiIndexExport, AiwgFortemiRecord } from '../../aiwg-index.js'
import { aiwgFortemiIndexToKnowledgeShard } from '../../aiwg-index-shard.js'
import { exportShardWithReport } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { unpackTarGz } from '../../shard/shard-tar.js'
import { validateCoreV1ShardArchive } from '../../shard/schema-validator.js'

const decoder = new TextDecoder()

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

function record(
  id: string,
  title: string,
  repoRelativePath: string,
  overrides: Partial<AiwgFortemiRecord> = {},
): AiwgFortemiRecord {
  return {
    schema_version: 'aiwg.fortemi.index.record.v2',
    id,
    type: 'aiwg.memory',
    source: {
      path: repoRelativePath,
      repo_relative_path: repoRelativePath,
      locator: id,
      origin: 'aiwg',
      generated: false,
      checksum: `sha256:${id}`,
      updated_at: '2026-07-20T12:00:00.000Z',
    },
    title,
    text: `${title} content`,
    facets: {},
    tags: ['memory'],
    concepts: [],
    relationships: [],
    provenance: [{
      field: 'text',
      source: repoRelativePath,
      path: '$.text',
      confidence: 'source',
      privacy: 'sanitized',
    }],
    search: {
      title,
      body: `${title} content`,
      triggers: [],
      aliases: [],
      tags: ['memory'],
      frontmatter: {},
    },
    compatibility: { v1_strategy: 'preserve-flat-fields' },
    privacy: { classification: 'sanitized', pii: false, locality: 'project' },
    updated_at: '2026-07-20T12:00:00.000Z',
    ...overrides,
  }
}

function fixture(): AiwgFortemiIndexExport {
  return {
    schema_version: 'aiwg.fortemi.index.export.v2',
    generated_at: '2026-07-26T18:00:00.000Z',
    source: { repo: 'roctinam/aiwg', privacy: 'sanitized', graph: 'project' },
    compatibility: {
      previous_schema_version: 'aiwg.fortemi.index.export.v1',
      strategy: 'supported',
    },
    items: [
      record('aiwg:memory:active', 'Active memory', '.aiwg/memory/current/active.md', {
        operational_state: {
          classification: 'superseded',
          source_repo: 'roctinam/aiwg',
          source_kind: 'gitea-issue',
          source_id: '42',
        },
      }),
      record('aiwg:memory:retired', 'Retired memory', '.aiwg/memory/archive/retired.md', {
        state_transfer: { deleted_at: '2026-07-25T09:30:00.000Z' },
      }),
    ],
  }
}

function records(
  files: Map<string, Uint8Array>,
  filename: 'notes.jsonl' | 'collections.json',
): Array<Record<string, unknown>> {
  const text = decoder.decode(files.get(filename)!)
  const values = filename.endsWith('.jsonl')
    ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : JSON.parse(text)
  return (values as Array<Record<string, unknown>>)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

describe('AIWG v2 to PGlite core-v1 projection', { timeout: 30_000 }, () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('preserves native hierarchy and explicit tombstones through a clean import and re-export', async () => {
    const source = await aiwgFortemiIndexToKnowledgeShard(fixture(), {
      createdAt: '2026-07-26T18:00:00.000Z',
      matricVersion: '2026.7.26',
    })
    const sourceFiles = unpackTarGz(source)
    expect(await validateCoreV1ShardArchive(sourceFiles)).toEqual({ valid: true, errors: [] })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const imported = await importShard(db, source, { conflictStrategy: 'replace' })
      expect(imported.success, imported.errors.join('; ')).toBe(true)
    }

    const persisted = await db.query<{
      title: string
      deleted_at: string | null
      collection_name: string
      parent_name: string
    }>(`
      SELECT
        n.title,
        CASE
          WHEN n.deleted_at IS NULL THEN NULL
          ELSE to_char(n.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        END AS deleted_at,
        c.name AS collection_name,
        p.name AS parent_name
      FROM note n
      JOIN collection_note cn ON cn.note_id = n.id
      JOIN collection c ON c.id = cn.collection_id
      LEFT JOIN collection p ON p.id = c.parent_id
      ORDER BY n.title
    `)
    expect(persisted.rows).toEqual([
      {
        title: 'Active memory',
        deleted_at: null,
        collection_name: 'current',
        parent_name: 'memory',
      },
      {
        title: 'Retired memory',
        deleted_at: '2026-07-25T09:30:00.000Z',
        collection_name: 'archive',
        parent_name: 'memory',
      },
    ])

    const reexported = await exportShardWithReport(db, { profile: 'core-v1' })
    expect(reexported.success, reexported.errors.join('; ')).toBe(true)
    const reexportedFiles = unpackTarGz(reexported.archive!)
    expect(await validateCoreV1ShardArchive(reexportedFiles)).toEqual({ valid: true, errors: [] })
    expect(records(reexportedFiles, 'notes.jsonl')).toEqual(records(sourceFiles, 'notes.jsonl'))
    expect(records(reexportedFiles, 'collections.json')).toEqual(
      records(sourceFiles, 'collections.json'),
    )
  })
})
