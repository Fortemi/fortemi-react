import type { QueryExecutor } from '../storage-backend.js'
import type { NativeState } from './native-full-v1-import.js'
import type { ShardManifest } from './types.js'
import { nativeIdentities, nativeIdentityKey } from './native-identities.js'
import { sha256Hex } from './checksum.js'

const components = Object.keys(nativeIdentities) as (keyof NativeState)[]
const presenceTables = new Set(['tags', 'note_originals', 'note_revisions', 'note_revised_current',
  'embedding_configs', 'embedding_sets', 'embedding_set_members'])
const empty = (state: NativeState) => components.every((component) => state[component].length === 0)
const rowKey = (component: keyof NativeState, row: unknown) => nativeIdentityKey(nativeIdentities[component], row as Record<string, unknown>)

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}

/** Only lineage metadata is stored here; all component contents remain native. */
export async function writeNativeLineage(tx: QueryExecutor, selected: NativeState, manifest: ShardManifest, emptyInput: boolean): Promise<void> {
  const noRows = empty(selected)
  if (noRows && !emptyInput) return
  if (noRows) {
    const populated = await tx.query<{ present: boolean }>(`SELECT ${components.map((component) =>
      `EXISTS(SELECT 1 FROM ${nativeIdentities[component].table}${presenceTables.has(component) ? ' WHERE shard_export_present' : ''})`).join(' OR ')} AS present`)
    if (populated.rows[0].present) return
  }
  const metadata: Pick<ShardManifest, 'migration_history' | 'migrated_from'> = {}
  if (Object.hasOwn(manifest, 'migration_history')) metadata.migration_history = manifest.migration_history
  if (Object.hasOwn(manifest, 'migrated_from')) metadata.migrated_from = manifest.migrated_from
  const id = await sha256Hex(new TextEncoder().encode(JSON.stringify(canonical(metadata))))
  await tx.query(`INSERT INTO native_shard_lineage (id, migration_history, migrated_from)
    VALUES ($1, $2::jsonb, $3) ON CONFLICT DO NOTHING`,
  [id, Object.hasOwn(metadata, 'migration_history') ? JSON.stringify(metadata.migration_history) : null, metadata.migrated_from ?? null])
  if (noRows) {
    await tx.query(`INSERT INTO native_shard_empty_lineage (singleton, lineage_id) VALUES (TRUE, $1)
      ON CONFLICT (singleton) DO UPDATE SET lineage_id = EXCLUDED.lineage_id`, [id])
    return
  }
  await tx.query('DELETE FROM native_shard_empty_lineage')
  for (const component of components) for (const row of selected[component]) {
    await tx.query(`INSERT INTO native_shard_record_lineage (component, record_key, lineage_id)
      VALUES ($1, $2::jsonb, $3) ON CONFLICT (component, record_key) DO UPDATE SET lineage_id = EXCLUDED.lineage_id`,
    [component, rowKey(component, row), id])
  }
}

type LineageResult = { status: 'none' } | { status: 'mixed'; count: number }
  | { status: 'single'; metadata: Pick<ShardManifest, 'migration_history' | 'migrated_from'> }

export async function readNativeLineage(tx: QueryExecutor, state: NativeState): Promise<LineageResult> {
  const ids = new Set<string>()
  for (const component of components) {
    if (!state[component].length) continue
    const keys = state[component].map((row) => JSON.parse(rowKey(component, row)))
    const rows = await tx.query<{ lineage_id: string }>(`SELECT DISTINCT lineage_id FROM native_shard_record_lineage
      WHERE component = $1 AND record_key IN (SELECT value FROM jsonb_array_elements($2::jsonb))`, [component, JSON.stringify(keys)])
    for (const row of rows.rows) ids.add(row.lineage_id)
  }
  if (ids.size === 0 && empty(state)) {
    const rows = await tx.query<{ lineage_id: string }>('SELECT lineage_id FROM native_shard_empty_lineage')
    for (const row of rows.rows) ids.add(row.lineage_id)
  }
  if (ids.size > 1) return { status: 'mixed', count: ids.size }
  if (ids.size === 0) return { status: 'none' }
  const row = (await tx.query<{ migration_history: ShardManifest['migration_history'] | null; migrated_from: string | null }>(
    'SELECT migration_history, migrated_from FROM native_shard_lineage WHERE id = $1', [[...ids][0]])).rows[0]
  if (!row) throw new Error('Native record lineage is missing')
  return { status: 'single', metadata: {
    ...(row.migration_history === null ? {} : { migration_history: row.migration_history }),
    ...(row.migrated_from === null ? {} : { migrated_from: row.migrated_from }),
  } }
}
