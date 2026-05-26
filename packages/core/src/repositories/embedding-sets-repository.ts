/**
 * EmbeddingSetsRepository — named embedding set authoring and population API.
 */

import type { QueryExecutor } from '../storage-backend.js'
import { generateId } from '../uuid.js'

export interface EmbeddingSetRow {
  id: string
  name: string
  purpose: string | null
  model_name: string
  dimensions: number
  created_at: Date
}

export interface EmbeddingSetCreateInput {
  id?: string
  name: string
  purpose?: string | null
  model_name?: string
  dimensions?: number
}

export interface EmbeddingSetEmbeddingInput {
  id?: string
  note_id: string
  embedding_set_id: string
  vector: number[]
}

export class EmbeddingSetsRepository {
  constructor(private db: QueryExecutor) {}

  async create(input: EmbeddingSetCreateInput): Promise<EmbeddingSetRow> {
    const id = input.id ?? generateId()
    await this.db.query(
      `INSERT INTO embedding_set (id, name, purpose, model_name, dimensions)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        input.name,
        input.purpose ?? null,
        input.model_name ?? 'all-MiniLM-L6-v2',
        input.dimensions ?? 384,
      ],
    )
    return this.get(id)
  }

  async ensureDefault(): Promise<EmbeddingSetRow> {
    const existing = await this.db.query<EmbeddingSetRow>(
      `SELECT * FROM embedding_set WHERE name = $1 AND model_name = $2 ORDER BY created_at LIMIT 1`,
      ['Full content', 'all-MiniLM-L6-v2'],
    )
    if (existing.rows.length > 0) return existing.rows[0]

    return this.create({
      name: 'Full content',
      purpose: 'Semantic search over full revised note content',
      model_name: 'all-MiniLM-L6-v2',
      dimensions: 384,
    })
  }

  async get(id: string): Promise<EmbeddingSetRow> {
    const result = await this.db.query<EmbeddingSetRow>(
      `SELECT * FROM embedding_set WHERE id = $1`,
      [id],
    )
    if (result.rows.length === 0) throw new Error(`Embedding set not found: ${id}`)
    return result.rows[0]
  }

  async list(): Promise<EmbeddingSetRow[]> {
    const result = await this.db.query<EmbeddingSetRow>(
      `SELECT * FROM embedding_set ORDER BY created_at, name`,
    )
    return result.rows
  }

  async putEmbedding(input: EmbeddingSetEmbeddingInput): Promise<{ id: string }> {
    const set = await this.get(input.embedding_set_id)
    if (input.vector.length !== set.dimensions) {
      throw new Error(
        `Embedding vector has ${input.vector.length} dimensions; set ${set.id} expects ${set.dimensions}`,
      )
    }

    await this.db.query(
      `DELETE FROM embedding_set_member WHERE note_id = $1 AND embedding_set_id = $2`,
      [input.note_id, input.embedding_set_id],
    )
    await this.db.query(
      `DELETE FROM embedding WHERE note_id = $1 AND embedding_set_id = $2`,
      [input.note_id, input.embedding_set_id],
    )

    const embeddingId = input.id ?? generateId()
    const vector = `[${input.vector.join(',')}]`
    await this.db.query(
      `INSERT INTO embedding (id, note_id, embedding_set_id, vector)
       VALUES ($1, $2, $3, $4::vector)`,
      [embeddingId, input.note_id, input.embedding_set_id, vector],
    )

    await this.db.query(
      `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id)
       VALUES ($1, $2, $3)`,
      [input.embedding_set_id, input.note_id, embeddingId],
    )

    return { id: embeddingId }
  }
}
