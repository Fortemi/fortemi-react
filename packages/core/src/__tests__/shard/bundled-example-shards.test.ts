/**
 * Bundled example shard conformance — validates the exact artifacts deployed
 * with the examples gallery against the current schema and importer (#345).
 *
 * The featured knowledge-workspace demo imports these checked-in shards at
 * runtime (notes on mount, summaries on "Enable semantic search", full content
 * on demand). Typecheck and build cannot see schema drift inside the binary
 * artifacts, so this gate replays the demo's exact import sequence into one
 * freshly migrated database and validates every manifest, checksum, and row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { importShard } from '../../shard/shard-import.js'
import { unpackTarGz } from '../../shard/shard-tar.js'
import { validateChecksums } from '../../shard/checksum.js'
import { validateShardArchive } from '../../shard/schema-validator.js'
import type { ShardManifest } from '../../shard/types.js'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const corpusDir = resolve(testDir, '../../../../../examples/knowledge-workspace/public/fortemi-corpus')

const decoder = new TextDecoder()

function bundledShards(): string[] {
  return readdirSync(corpusDir)
    .filter((name) => name.endsWith('.shard'))
    .sort()
    .map((name) => join(corpusDir, name))
}

function loadShard(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}

describe('bundled example shards (#345)', { timeout: 300_000 }, () => {
  it('finds the knowledge-workspace corpus artifacts', () => {
    const names = bundledShards().map((p) => p.split('/').pop())
    expect(names).toEqual(['corpus.notes.shard', 'corpus.shard', 'corpus.summaries.shard'])
  })

  it.each(bundledShards().map((path) => [path.split('/').pop()!, path]))(
    '%s passes archive schema validation and checksum verification',
    async (_name, path) => {
      const archive = loadShard(path)
      expect(validateShardArchive(archive)).toEqual({ valid: true, errors: [] })

      const files = unpackTarGz(archive)
      const manifest: ShardManifest = JSON.parse(decoder.decode(files.get('manifest.json')!))
      const checksums = await validateChecksums(manifest.checksums, files)
      expect(checksums.failures).toEqual([])
      expect(checksums.valid).toBe(true)
    },
  )

  describe('demo upgrade path import sequence', () => {
    let db: PGlite

    beforeAll(async () => {
      db = await PGlite.create({ extensions: { vector } })
      await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
      await new MigrationRunner(db).apply(allMigrations)
    })

    afterAll(async () => {
      await db.close()
    })

    it('imports corpus.notes.shard (mount: full-text search)', async () => {
      const result = await importShard(db, loadShard(join(corpusDir, 'corpus.notes.shard')))
      expect(result.errors).toEqual([])
      expect(result.success).toBe(true)
      expect(result.counts.notes).toBeGreaterThan(0)
    })

    it('imports corpus.summaries.shard on top (Enable semantic search)', async () => {
      const result = await importShard(db, loadShard(join(corpusDir, 'corpus.summaries.shard')), {
        conflictStrategy: 'skip',
      })
      expect(result.errors).toEqual([])
      expect(result.success).toBe(true)
      expect(result.counts.embeddings).toBeGreaterThan(0)

      const rows = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM embedding')
      expect(rows.rows[0].n).toBe(result.counts.embeddings)
    })

    it('imports corpus.shard on top (Content set on demand)', async () => {
      const before = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM embedding')
      const result = await importShard(db, loadShard(join(corpusDir, 'corpus.shard')), {
        conflictStrategy: 'skip',
      })
      expect(result.errors).toEqual([])
      expect(result.success).toBe(true)

      const after = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM embedding')
      expect(after.rows[0].n).toBeGreaterThan(before.rows[0].n)
    })
  })
})
