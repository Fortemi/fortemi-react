import type { QueryExecutor } from '../storage-backend.js'
import { nativeUuid, selectNativeFields, upsertNativeFields, type NativeField, type NativeFields } from './native-fields.js'

export interface NativeGraphSource {
  id: string
  name: string
  kind: 'link' | 'similarity' | 'search' | 'manual' | 'imported'
  source_table: 'link' | 'embedding' | 'manual' | null
  embedding_set_id: string | null
  virtual_set_id: string | null
  model: string | null
  dimension: number | null
  truncate_dimension: number | null
  metric: 'cosine' | 'inner_product' | 'l2' | null
  algorithm: string | null
  parameters: Record<string, unknown> | null
  input_hash: string
  freshness: Record<string, unknown>
  created_at: string
}
export interface NativeGraphEdge {
  graph_source_id: string
  from_note_id: string
  to_note_id: string
  weight: number
  kind: 'link' | 'similarity' | 'manual'
  rank: number | null
  metadata: Record<string, unknown> | null
}
export interface NativeCommunity {
  id: string
  label: string | null
  rank: number | null
  size: number | null
  confidence: number | null
  representative_note_ids: string[] | null
  metadata: Record<string, unknown> | null
}
export interface NativeCommunitySet {
  id: string
  graph_source_id: string
  name: string
  source_type: 'precomputed' | 'dynamic-snapshot' | 'user-authored' | 'imported'
  algorithm: string | null
  parameters: Record<string, unknown> | null
  input_hash: string
  freshness: Record<string, unknown>
  communities: NativeCommunity[]
  created_at: string
}
export interface NativeCommunityAssignment {
  community_set_id: string
  community_id: string
  note_id: string
  confidence: number | null
  source_type: NativeCommunitySet['source_type']
  metadata: Record<string, unknown> | null
}
export interface NativeGraph {
  graph_sources: NativeGraphSource[]
  graph_edges: NativeGraphEdge[]
  communities: NativeCommunitySet[]
  community_assignments: NativeCommunityAssignment[]
}
type Component = keyof NativeGraph
type RecordFor<K extends Component> = NativeGraph[K][number]
type SetFields = Omit<NativeCommunitySet, 'communities'>
const sourceFields: NativeFields<NativeGraphSource> = {
  id: {}, name: {}, kind: {}, source_table: {}, embedding_set_id: { kind: 'uuid' }, virtual_set_id: {}, model: {},
  dimension: {}, truncate_dimension: {}, metric: {}, algorithm: {}, parameters: { column: 'parameters_json', kind: 'json' },
  input_hash: {}, freshness: { column: 'freshness_json', kind: 'json' }, created_at: { kind: 'timestamp' },
}
const edgeFields: NativeFields<NativeGraphEdge> = {
  graph_source_id: {}, from_note_id: { kind: 'uuid' }, to_note_id: { kind: 'uuid' }, weight: {}, kind: {}, rank: {},
  metadata: { column: 'metadata_json', kind: 'json' },
}
const setFields: NativeFields<SetFields> = {
  id: {}, graph_source_id: {}, name: {}, source_type: {}, algorithm: {}, parameters: { column: 'parameters_json', kind: 'json' },
  input_hash: {}, freshness: { column: 'freshness_json', kind: 'json' }, created_at: { kind: 'timestamp' },
}
const communityFields: NativeFields<NativeCommunity> = {
  id: {}, label: {}, rank: {}, size: {}, confidence: {}, representative_note_ids: {}, metadata: { column: 'metadata_json', kind: 'json' },
}
const assignmentFields: NativeFields<NativeCommunityAssignment> = {
  community_set_id: {}, community_id: {}, note_id: { kind: 'uuid' }, confidence: {}, source_type: {}, metadata: { column: 'metadata_json', kind: 'json' },
}

/** Internal stage. Caller owns whole-archive validation, selected-owner deletion,
 * conflict decisions, dependent notes and the enclosing transaction. Nested
 * communities are a complete field value of each included community set. */
export async function applyValidatedNativeGraph(tx: QueryExecutor, state: NativeGraph): Promise<void> {
  for (const row of state.graph_sources) await upsertNativeFields(tx, 'graph_source', row, sourceFields, ['id'])
  for (const row of state.graph_edges) await upsertNativeFields(tx, 'graph_edge_artifact', row, edgeFields,
    ['graph_source_id', 'from_note_id', 'to_note_id', 'kind'])
  for (const row of state.communities) {
    await upsertNativeFields(tx, 'community_set', row, setFields, ['id'])
    await tx.query('DELETE FROM community WHERE community_set_id = $1 AND NOT (id = ANY($2::text[]))',
      [row.id, row.communities.map((community) => community.id)])
    for (const [position, community] of row.communities.entries()) {
      await upsertNativeFields(tx, 'community', { ...community,
        representative_note_ids: community.representative_note_ids?.map((id) => nativeUuid(id)!) ?? null },
      communityFields, ['community_set_id', 'id'], { community_set_id: row.id, position })
    }
  }
  for (const row of state.community_assignments) await upsertNativeFields(tx, 'community_assignment', row, assignmentFields,
    ['community_set_id', 'note_id'])
}

export async function readNativeCommunities(tx: QueryExecutor, setId: string): Promise<NativeCommunity[]> {
  return (await tx.query<NativeCommunity>(`SELECT ${selectNativeFields(communityFields)} FROM community
    WHERE community_set_id = $1 ORDER BY position NULLS LAST, rank NULLS LAST, id`, [setId])).rows
}

export async function readNativeGraphComponent<K extends Component>(
  tx: QueryExecutor, component: K, filter: Partial<Record<keyof RecordFor<K>, string>> = {},
): Promise<RecordFor<K>[]> {
  const storage = {
    graph_sources: { table: 'graph_source', fields: sourceFields, order: 'id' },
    graph_edges: { table: 'graph_edge_artifact', fields: edgeFields, order: 'graph_source_id, from_note_id, to_note_id, kind' },
    communities: { table: 'community_set', fields: setFields, order: 'id' },
    community_assignments: { table: 'community_assignment', fields: assignmentFields, order: 'community_set_id, note_id' },
  }[component]
  const params: unknown[] = []
  const fields: Record<string, NativeField> = storage.fields
  const predicates = Object.entries(filter).map(([name, value]) => {
    if (!Object.hasOwn(fields, name)) throw new Error(`Unknown graph filter: ${name}`)
    const field = fields[name]
    params.push(field.kind === 'uuid' ? nativeUuid(value as string) : value)
    return `${field.column ?? name} = $${params.length}`
  })
  const result = await tx.query<RecordFor<K>>(`SELECT ${selectNativeFields(fields)} FROM ${storage.table}
    ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY ${storage.order}`, params)
  if (component === 'communities' && result.rows.length) {
    const sets = result.rows as NativeCommunitySet[]
    const byId = new Map(sets.map((set) => { set.communities = []; return [set.id, set] }))
    const children = await tx.query<NativeCommunity & { community_set_id: string }>(
      `SELECT community_set_id, ${selectNativeFields(communityFields)} FROM community
       WHERE community_set_id = ANY($1::text[]) ORDER BY community_set_id, position NULLS LAST, rank NULLS LAST, id`,
      [sets.map((set) => set.id)])
    for (const { community_set_id, ...community } of children.rows) byId.get(community_set_id)!.communities.push(community)
  }
  return result.rows
}

export async function readNativeGraph(tx: QueryExecutor): Promise<NativeGraph> {
  return {
    graph_sources: await readNativeGraphComponent(tx, 'graph_sources'),
    graph_edges: await readNativeGraphComponent(tx, 'graph_edges'),
    communities: await readNativeGraphComponent(tx, 'communities'),
    community_assignments: await readNativeGraphComponent(tx, 'community_assignments'),
  }
}
