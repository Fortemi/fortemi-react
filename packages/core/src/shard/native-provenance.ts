import type { QueryExecutor } from '../storage-backend.js'
import { nativeUuid, selectNativeFields, upsertNativeFields, type NativeFields, type NativeApplyProgress } from './native-fields.js'
import { currentGeometryEwkb, decodeWgs84Ewkb, type Wgs84Geometry, type Wgs84Point, type Wgs84Polygon } from './native-geometry.js'

export interface NativeProvenanceActivity {
  id: string
  note_id: string
  revision_id: string | null
  activity_type: string
  model_name: string | null
  started_at: string
  ended_at: string | null
  metadata: unknown
}
export interface NativeProvenanceEdge {
  id: string
  revision_id: string | null
  source_note_id: string | null
  source_url: string | null
  relation: string
  created_at_utc: string
}
export interface NativeNamedLocation {
  id: string
  name: string
  slug: string
  display_name: string | null
  location_type: 'home' | 'work' | 'poi' | 'city' | 'region' | 'country'
  point_ewkb_hex: string | null
  boundary_ewkb_hex: string | null
  radius_m: number | null
  address_line: string | null
  locality: string | null
  admin_area: string | null
  country: string | null
  country_code: string | null
  postal_code: string | null
  timezone: string | null
  altitude_m: number | null
  owner_id: string | null
  is_private: boolean | null
  metadata: unknown
  created_at: string
  updated_at: string
}
export interface NativeProvenanceLocation {
  id: string
  point_ewkb_hex: string
  horizontal_accuracy_m: number | null
  altitude_m: number | null
  vertical_accuracy_m: number | null
  heading_degrees: number | null
  speed_mps: number | null
  named_location_id: string | null
  source: 'gps_exif' | 'device_api' | 'user_manual' | 'geocoded' | 'ai_estimated' | 'unknown'
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  created_at: string
}
export interface NativeProvenanceDevice {
  id: string
  device_make: string | null
  device_model: string | null
  device_os: string | null
  device_os_version: string | null
  software: string | null
  software_version: string | null
  has_gps: boolean | null
  has_accelerometer: boolean | null
  sensor_metadata: unknown
  owner_id: string | null
  device_name: string | null
  created_at: string
}
export interface NativeTimestampRange {
  empty: boolean
  lower: string | null
  lower_inclusive: boolean
  lower_infinite: boolean
  upper: string | null
  upper_inclusive: boolean
  upper_infinite: boolean
}
export interface NativeProvenanceRecord {
  id: string
  attachment_id: string | null
  note_id: string | null
  capture_time: NativeTimestampRange | null
  capture_timezone: string | null
  capture_duration_seconds: number | null
  time_source: 'exif' | 'file_mtime' | 'user_manual' | 'ai_estimated' | 'gps' | 'network' | 'manual' | 'file_metadata' | 'device_clock' | null
  time_confidence: 'high' | 'medium' | 'low' | 'unknown' | 'exact' | 'approximate' | 'estimated' | null
  location_id: string | null
  device_id: string | null
  activity_id: string | null
  event_type: 'photo' | 'video' | 'audio' | 'scan' | 'screenshot' | 'recording' | 'unknown' | 'created' | 'modified' | 'accessed' | 'shared' | null
  event_title: string | null
  event_description: string | null
  raw_metadata: unknown
  ai_context: unknown
  ai_processed_at: string | null
  ai_model: string | null
  user_corrected: boolean | null
  original_capture_time: NativeTimestampRange | null
  original_location_id: string | null
  correction_note: string | null
  created_at: string
}
export interface NativeProvenance {
  provenance_activities: NativeProvenanceActivity[]
  provenance_edges: NativeProvenanceEdge[]
  named_locations: NativeNamedLocation[]
  provenance_locations: NativeProvenanceLocation[]
  provenance_devices: NativeProvenanceDevice[]
  provenance_records: NativeProvenanceRecord[]
}
type Component = keyof NativeProvenance
type RecordFor<K extends Component> = NativeProvenance[K][number]
const storage: { [K in Component]: { table: string; fields: NativeFields<RecordFor<K>> } } = {
  provenance_activities: { table: 'provenance_edge', fields: {
    id: { kind: 'uuid' }, note_id: { kind: 'uuid' }, revision_id: { kind: 'uuid' }, activity_type: { column: 'activity' },
    model_name: { column: 'agent' }, started_at: { kind: 'timestamp' }, ended_at: { kind: 'timestamp' }, metadata: { column: 'attributes', kind: 'json' },
  } },
  provenance_edges: { table: 'provenance_derivation', fields: {
    id: { kind: 'uuid' }, revision_id: { kind: 'uuid' }, source_note_id: { kind: 'uuid' }, source_url: {}, relation: {},
    created_at_utc: { column: 'created_at', kind: 'timestamp' },
  } },
  named_locations: { table: 'named_location', fields: {
    id: { kind: 'uuid' }, name: {}, slug: {}, display_name: {}, location_type: {}, point_ewkb_hex: {}, boundary_ewkb_hex: {},
    radius_m: {}, address_line: {}, locality: {}, admin_area: {}, country: {}, country_code: {}, postal_code: {}, timezone: {},
    altitude_m: {}, owner_id: { kind: 'uuid' }, is_private: {}, metadata: { kind: 'json' },
    created_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' },
  } },
  provenance_locations: { table: 'provenance_location', fields: {
    id: { kind: 'uuid' }, point_ewkb_hex: {}, horizontal_accuracy_m: {}, altitude_m: {}, vertical_accuracy_m: {}, heading_degrees: {},
    speed_mps: {}, named_location_id: { kind: 'uuid' }, source: {}, confidence: {}, created_at: { kind: 'timestamp' },
  } },
  provenance_devices: { table: 'provenance_device', fields: {
    id: { kind: 'uuid' }, device_make: {}, device_model: {}, device_os: {}, device_os_version: {}, software: {}, software_version: {},
    has_gps: {}, has_accelerometer: {}, sensor_metadata: { kind: 'json' }, owner_id: { kind: 'uuid' }, device_name: {}, created_at: { kind: 'timestamp' },
  } },
  provenance_records: { table: 'provenance_record', fields: {
    id: { kind: 'uuid' }, attachment_id: { kind: 'uuid' }, note_id: { kind: 'uuid' }, capture_time: { kind: 'range' },
    capture_timezone: {}, capture_duration_seconds: {}, time_source: {}, time_confidence: {}, location_id: { kind: 'uuid' },
    device_id: { kind: 'uuid' }, activity_id: { kind: 'uuid' }, event_type: {}, event_title: {}, event_description: {},
    raw_metadata: { kind: 'json' }, ai_context: { kind: 'json' }, ai_processed_at: { kind: 'timestamp' }, ai_model: {},
    user_corrected: {}, original_capture_time: { kind: 'range' }, original_location_id: { kind: 'uuid' }, correction_note: {}, created_at: { kind: 'timestamp' },
  } },
}

/** Complete geometry decoding is a preflight operation, with no database access. */
export function prepareNativeProvenanceGeometry(state: NativeProvenance): {
  named: Map<string, { point: Wgs84Point | null; boundary: Wgs84Polygon | null }>
  locations: Map<string, Wgs84Point>
} {
  return {
    named: new Map(state.named_locations.map((row) => [nativeUuid(row.id)!, {
      point: row.point_ewkb_hex === null ? null : decodeWgs84Ewkb(row.point_ewkb_hex, 'Point'),
      boundary: row.boundary_ewkb_hex === null ? null : decodeWgs84Ewkb(row.boundary_ewkb_hex, 'Polygon'),
    }])),
    locations: new Map(state.provenance_locations.map((row) => [nativeUuid(row.id)!, decodeWgs84Ewkb(row.point_ewkb_hex, 'Point')])),
  }
}

/** Internal stage. Caller owns whole-archive validation, conflict/selection
 * decisions, dependent note/revision/attachment state and the enclosing transaction. */
export async function applyValidatedNativeProvenance(tx: QueryExecutor, state: NativeProvenance, progress?: NativeApplyProgress): Promise<void> {
  const geometry = prepareNativeProvenanceGeometry(state)
  async function apply<K extends Component>(component: K): Promise<void> {
    const { table, fields } = storage[component]
    for (const row of state[component]) {
      const extra: Record<string, unknown> = {}
      if (component === 'provenance_activities') {
        const activity = row as NativeProvenanceActivity
        extra.entity_type = activity.revision_id === null ? 'note' : 'revision'
        extra.entity_id = nativeUuid(activity.revision_id ?? activity.note_id)
      } else if (component === 'named_locations') {
        const value = geometry.named.get(nativeUuid(row.id)!)!
        extra.point = value.point === null ? null : JSON.stringify(value.point)
        extra.boundary = value.boundary === null ? null : JSON.stringify(value.boundary)
      } else if (component === 'provenance_locations') {
        extra.point = JSON.stringify(geometry.locations.get(nativeUuid(row.id)!))
      }
      await upsertNativeFields(tx, table, row, fields, ['id'], extra)
      await progress?.(component)
    }
  }
  for (const component of Object.keys(storage) as Component[]) await apply(component)
}

export async function readNativeProvenanceComponent<K extends Component>(
  tx: QueryExecutor, component: K, filter: Partial<Record<keyof RecordFor<K>, string | readonly string[]>> = {},
): Promise<RecordFor<K>[]> {
  const { table, fields } = storage[component]
  const params: unknown[] = []
  const predicates = Object.entries(filter).map(([name, value]) => {
    if (!Object.hasOwn(fields, name)) throw new Error(`Unknown provenance filter: ${name}`)
    const field = fields[name as keyof typeof fields]
    const normalized = (item: string) => field.kind === 'uuid' ? nativeUuid(item) : item
    params.push(Array.isArray(value) ? value.map(normalized) : normalized(value as string))
    return Array.isArray(value) ? `${field.column ?? name} = ANY($${params.length}::text[])` : `${field.column ?? name} = $${params.length}`
  })
  const geometry = component === 'named_locations' ? ', point, boundary' : component === 'provenance_locations' ? ', point' : ''
  const rows = await tx.query<RecordFor<K> & { point?: Wgs84Geometry | null; boundary?: Wgs84Polygon | null }>(
    `SELECT ${selectNativeFields(fields)}${geometry} FROM ${table}
      ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY id`, params)
  return rows.rows.map((row) => {
    const { point, boundary, ...record } = row
    if ('point_ewkb_hex' in record) record.point_ewkb_hex = currentGeometryEwkb(record.point_ewkb_hex as string | null, point ?? null) as string
    if ('boundary_ewkb_hex' in record) record.boundary_ewkb_hex = currentGeometryEwkb(record.boundary_ewkb_hex as string | null, boundary ?? null)
    return record as RecordFor<K>
  })
}

/** Rich native records, not an archival snapshot or a synthetic empty projection. */
export async function readNativeProvenance(tx: QueryExecutor, deferValidation = false, noteIds?: readonly string[]): Promise<NativeProvenance> {
  const unsupported = await tx.query('SELECT id FROM provenance_edge WHERE note_id IS NULL LIMIT 1')
  if (!deferValidation && unsupported.rows.length) throw new Error('unrepresentable-live-provenance-entity: activity has no native note owner')
  if (noteIds !== undefined) {
    const selected = noteIds.map((id) => nativeUuid(id)!)
    const attachments = (await tx.query<{ id: string }>('SELECT id FROM attachment WHERE note_id = ANY($1::text[])', [selected])).rows.map((row) => row.id)
    const revisions = (await tx.query<{ id: string }>('SELECT id FROM note_revision WHERE note_id = ANY($1::text[])', [selected])).rows.map((row) => row.id)
    const merge = <T extends { id: string }>(...groups: T[][]): T[] => [...new Map(groups.flat().map((row) => [row.id, row])).values()]
    const activities = await readNativeProvenanceComponent(tx, 'provenance_activities', { note_id: selected })
    const activityIds = new Set(activities.map((row) => row.id))
    const records = merge(
      await readNativeProvenanceComponent(tx, 'provenance_records', { note_id: selected }),
      await readNativeProvenanceComponent(tx, 'provenance_records', { attachment_id: attachments }),
    ).filter((row) => row.activity_id === null || activityIds.has(row.activity_id))
    // Establish registry closure in SQL before decoding geometry or ranges.
    // Invalid state outside the requested notes is not an export dependency.
    const locationIds = [...new Set(records.flatMap((row) => [row.location_id, row.original_location_id].filter((id): id is string => id !== null)))]
    const locations = await readNativeProvenanceComponent(tx, 'provenance_locations', { id: locationIds })
    const namedIds = [...new Set(locations.flatMap((row) => row.named_location_id === null ? [] : [row.named_location_id]))]
    const deviceIds = [...new Set(records.flatMap((row) => row.device_id === null ? [] : [row.device_id]))]
    return {
      provenance_activities: activities,
      provenance_edges: merge(
        await readNativeProvenanceComponent(tx, 'provenance_edges', { revision_id: revisions }),
        await readNativeProvenanceComponent(tx, 'provenance_edges', { source_note_id: selected }),
      ),
      provenance_records: records, provenance_locations: locations,
      named_locations: await readNativeProvenanceComponent(tx, 'named_locations', { id: namedIds }),
      provenance_devices: await readNativeProvenanceComponent(tx, 'provenance_devices', { id: deviceIds }),
    }
  }
  return {
    provenance_activities: await readNativeProvenanceComponent(tx, 'provenance_activities'),
    provenance_edges: await readNativeProvenanceComponent(tx, 'provenance_edges'),
    named_locations: await readNativeProvenanceComponent(tx, 'named_locations'),
    provenance_locations: await readNativeProvenanceComponent(tx, 'provenance_locations'),
    provenance_devices: await readNativeProvenanceComponent(tx, 'provenance_devices'),
    provenance_records: await readNativeProvenanceComponent(tx, 'provenance_records'),
  }
}
