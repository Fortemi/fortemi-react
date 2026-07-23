import type { QueryExecutor } from '../storage-backend.js'
import type { KnowledgeShardProfile, ShardComponent } from './types.js'
import type { ShardPresenceMap, StoredPresenceState } from './presence.js'
import { presencePointers } from './presence.js'

export interface StoredShardPresence {
  schema_version: string
  profile: KnowledgeShardProfile
  component: ShardComponent
  record_id: string
  field_path: string
  state: StoredPresenceState
}

export async function replaceStoredPresence(
  tx: QueryExecutor,
  schemaVersion: string,
  profile: KnowledgeShardProfile,
  component: ShardComponent,
  recordId: string,
  presence: ShardPresenceMap,
): Promise<void> {
  await tx.query(
    `DELETE FROM shard_field_presence
      WHERE schema_version = $1 AND profile = $2 AND component = $3 AND record_id = $4`,
    [schemaVersion, profile, component, recordId],
  )
  for (const [fieldPath, state] of Object.entries(presence)) {
    await tx.query(
      `INSERT INTO shard_field_presence
         (schema_version, profile, component, record_id, field_path, state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [schemaVersion, profile, component, recordId, fieldPath, state],
    )
  }
}

export async function readStoredPresence(
  tx: QueryExecutor,
  schemaVersion: string,
  profile: KnowledgeShardProfile,
  component: ShardComponent,
  recordId: string,
): Promise<ShardPresenceMap> {
  const result = await tx.query<{ field_path: string; state: StoredPresenceState }>(
    `SELECT field_path, state FROM shard_field_presence
      WHERE schema_version = $1 AND profile = $2 AND component = $3 AND record_id = $4
      ORDER BY field_path`,
    [schemaVersion, profile, component, recordId],
  )
  const stored = Object.fromEntries(result.rows.map((row) => [row.field_path, row.state]))
  if (schemaVersion !== '2.0.0') return stored
  for (const pointer of presencePointers(profile, component)) {
    if (!pointer.includes('/*') && stored[pointer] === undefined) {
      stored[pointer] = 'legacy-indeterminate'
    }
  }
  return stored
}
