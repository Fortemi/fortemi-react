import type { DatabaseClient } from '../storage-backend.js'
import { generateId } from '../uuid.js'
import { readNativeProvenanceComponent } from '../shard/native-provenance.js'

export interface ProvenanceEdge {
  id: string
  entity_type: string
  entity_id: string
  activity: string
  agent: string | null
  started_at: Date
  ended_at: Date | null
  attributes: unknown
}

export interface RecordProvenanceInput {
  activity: string
  agent: string | null
  startedAt?: Date | string
  endedAt?: Date | string | null
  attributes?: unknown
}

export class ProvenanceRepository {
  constructor(private db: DatabaseClient) {}

  async recordProvenance(
    entityType: string,
    entityId: string,
    input: RecordProvenanceInput,
  ): Promise<ProvenanceEdge> {
    const id = generateId()
    await this.db.query(
      `INSERT INTO provenance_edge (id, entity_type, entity_id, activity, agent, started_at, ended_at, attributes)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7, $8)`,
      [
        id,
        entityType,
        entityId,
        input.activity,
        input.agent,
        input.startedAt ?? null,
        input.endedAt ?? null,
        input.attributes === undefined ? null : JSON.stringify(input.attributes),
      ],
    )
    const result = await this.db.query<ProvenanceEdge>(`SELECT * FROM provenance_edge WHERE id = $1`, [id])
    return result.rows[0]
  }

  async forEntity(entityType: string, entityId: string): Promise<ProvenanceEdge[]> {
    const result = await this.db.query<ProvenanceEdge>(
      `SELECT *
       FROM provenance_edge
       WHERE (entity_type = $1 AND entity_id = $2)
          OR ($1 = 'note' AND note_id = $2)
          OR ($1 = 'revision' AND revision_id = $2)
       ORDER BY started_at`,
      [entityType, entityId],
    )
    return result.rows
  }

  async getActivity(id: string) {
    return (await readNativeProvenanceComponent(this.db, 'provenance_activities', { id }))[0] ?? null
  }

  async activitiesForNote(noteId: string) {
    return readNativeProvenanceComponent(this.db, 'provenance_activities', { note_id: noteId })
  }

  async derivationsForRevision(revisionId: string) {
    return readNativeProvenanceComponent(this.db, 'provenance_edges', { revision_id: revisionId })
  }

  async getNamedLocation(id: string) {
    return (await readNativeProvenanceComponent(this.db, 'named_locations', { id }))[0] ?? null
  }

  async getLocation(id: string) {
    return (await readNativeProvenanceComponent(this.db, 'provenance_locations', { id }))[0] ?? null
  }

  async getDevice(id: string) {
    return (await readNativeProvenanceComponent(this.db, 'provenance_devices', { id }))[0] ?? null
  }

  async getCapture(id: string) {
    return (await readNativeProvenanceComponent(this.db, 'provenance_records', { id }))[0] ?? null
  }

  async captureForNote(noteId: string) {
    return (await readNativeProvenanceComponent(this.db, 'provenance_records', { note_id: noteId }))[0] ?? null
  }
}
