/**
 * Embedding generation job handler.
 * Generates and stores vector embeddings for note content.
 * Embed function is injected via setEmbedFunction — no WASM loaded by default.
 *
 * @implements #63 embedding generation
 */

import type { PGlite } from '@electric-sql/pglite'
import { generateId } from '../uuid.js'
import { chunkText } from './chunking.js'

/** Type for the embed function — injected by the semantic capability module */
export type EmbedFunction = (texts: string[]) => Promise<number[][]>

let embedFn: EmbedFunction | null = null

export function setEmbedFunction(fn: EmbedFunction | null): void {
  embedFn = fn
}

export function getEmbedFunction(): EmbedFunction | null {
  return embedFn
}

/** Ensure a default embedding set exists and return its ID */
async function ensureEmbeddingSet(db: PGlite): Promise<string> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM embedding_set WHERE model_name = $1`,
    ['all-MiniLM-L6-v2']
  )
  if (result.rows.length > 0) return result.rows[0].id

  const id = generateId()
  await db.query(
    `INSERT INTO embedding_set (id, model_name, dimensions) VALUES ($1, $2, $3)`,
    [id, 'all-MiniLM-L6-v2', 384]
  )
  return id
}

/**
 * Average multiple embeddings into a single vector.
 * Used to collapse chunk embeddings into one representative vector per note.
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 1) return embeddings[0]
  const dims = embeddings[0].length
  const avg = new Array<number>(dims).fill(0)
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) {
      avg[i] += emb[i]
    }
  }
  for (let i = 0; i < dims; i++) {
    avg[i] /= embeddings.length
  }
  // Normalize
  const norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0))
  return norm > 0 ? avg.map(v => v / norm) : avg
}

/** Job handler for embedding generation. Registered in JobQueueWorker. */
export async function embeddingGenerationHandler(
  job: { note_id: string },
  db: PGlite,
): Promise<unknown> {
  const fn = embedFn
  if (!fn) return { skipped: true, reason: 'no embed function registered' }

  // Get note content
  const noteResult = await db.query<{ content: string }>(
    `SELECT content FROM note_revised_current WHERE note_id = $1`,
    [job.note_id]
  )
  if (noteResult.rows.length === 0) throw new Error(`No content for note ${job.note_id}`)

  const content = noteResult.rows[0].content
  const chunks = chunkText(content)

  // Generate embeddings for all chunks
  const embeddings = await fn(chunks)

  // Average all chunk embeddings into one vector for storage
  const vector = averageEmbeddings(embeddings)

  // Get or create embedding set
  const setId = await ensureEmbeddingSet(db)

  // Delete old embeddings for this note in this set (member first due to FK)
  await db.query(
    `DELETE FROM embedding_set_member WHERE note_id = $1 AND embedding_set_id = $2`,
    [job.note_id, setId]
  )
  await db.query(
    `DELETE FROM embedding WHERE note_id = $1 AND embedding_set_id = $2`,
    [job.note_id, setId]
  )

  // Insert new embedding (one averaged vector per note per set)
  const embId = generateId()
  const vectorStr = `[${vector.join(',')}]`
  await db.query(
    `INSERT INTO embedding (id, note_id, embedding_set_id, vector) VALUES ($1, $2, $3, $4::vector)`,
    [embId, job.note_id, setId, vectorStr]
  )
  await db.query(
    `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id) VALUES ($1, $2, $3)
     ON CONFLICT (embedding_set_id, note_id) DO UPDATE SET embedding_id = $3`,
    [setId, job.note_id, embId]
  )

  return { chunks: chunks.length, embeddings: embeddings.length, setId }
}
