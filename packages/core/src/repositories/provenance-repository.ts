import type { DatabaseClient } from '../storage-backend.js'
import { generateId } from '../uuid.js'

export interface ProvenanceEdge {
  id: string
  entity_type: string
  entity_id: string
  activity: string
  agent: string
  started_at: Date
  ended_at: Date | null
  attributes: Record<string, unknown> | null
}

export interface RecordProvenanceInput {
  activity: string
  agent: string
  startedAt?: Date | string
  endedAt?: Date | string | null
  attributes?: Record<string, unknown> | null
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
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY started_at`,
      [entityType, entityId],
    )
    return result.rows
  }
}
