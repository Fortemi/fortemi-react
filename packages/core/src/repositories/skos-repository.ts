/**
 * SkosRepository — SKOS taxonomy management (schemes, concepts, relations).
 *
 * Responsibilities:
 * - Create and soft-delete SKOS schemes (taxonomy containers)
 * - Create, list, and soft-delete SKOS concepts within schemes
 * - Create and query broader/narrower/related concept relations
 */

import type { PGlite } from '@electric-sql/pglite'
import { generateId } from '../uuid.js'

export interface SkosScheme {
  id: string
  title: string
  description: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface SkosConcept {
  id: string
  scheme_id: string
  pref_label: string
  alt_labels: string[]
  definition: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface SkosRelation {
  id: string
  source_concept_id: string
  target_concept_id: string
  relation_type: string
  created_at: Date
}

export class SkosRepository {
  constructor(private db: PGlite) {}

  // ── Schemes ──────────────────────────────────────────────────────────────

  async createScheme(title: string, description?: string): Promise<SkosScheme> {
    const id = generateId()
    await this.db.query(
      `INSERT INTO skos_scheme (id, title, description) VALUES ($1, $2, $3)`,
      [id, title, description ?? null],
    )
    const result = await this.db.query<SkosScheme>(`SELECT * FROM skos_scheme WHERE id = $1`, [id])
    return result.rows[0]
  }

  async listSchemes(): Promise<SkosScheme[]> {
    const result = await this.db.query<SkosScheme>(
      `SELECT * FROM skos_scheme WHERE deleted_at IS NULL ORDER BY title`,
    )
    return result.rows
  }

  async deleteScheme(id: string): Promise<void> {
    await this.db.query(`UPDATE skos_scheme SET deleted_at = now() WHERE id = $1`, [id])
  }

  // ── Concepts ─────────────────────────────────────────────────────────────

  async createConcept(
    schemeId: string,
    prefLabel: string,
    options?: { altLabels?: string[]; definition?: string },
  ): Promise<SkosConcept> {
    const id = generateId()
    await this.db.query(
      `INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition) VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        schemeId,
        prefLabel,
        JSON.stringify(options?.altLabels ?? []),
        options?.definition ?? null,
      ],
    )
    const result = await this.db.query<SkosConcept>(
      `SELECT * FROM skos_concept WHERE id = $1`,
      [id],
    )
    return result.rows[0]
  }

  async listConcepts(schemeId: string): Promise<SkosConcept[]> {
    const result = await this.db.query<SkosConcept>(
      `SELECT * FROM skos_concept WHERE scheme_id = $1 AND deleted_at IS NULL ORDER BY pref_label`,
      [schemeId],
    )
    return result.rows
  }

  async deleteConcept(id: string): Promise<void> {
    await this.db.query(`UPDATE skos_concept SET deleted_at = now() WHERE id = $1`, [id])
  }

  // ── Relations ─────────────────────────────────────────────────────────────

  async createRelation(
    sourceConceptId: string,
    targetConceptId: string,
    relationType: 'broader' | 'narrower' | 'related',
  ): Promise<SkosRelation> {
    const id = generateId()
    await this.db.query(
      `INSERT INTO skos_concept_relation (id, source_concept_id, target_concept_id, relation_type) VALUES ($1, $2, $3, $4)`,
      [id, sourceConceptId, targetConceptId, relationType],
    )
    const result = await this.db.query<SkosRelation>(
      `SELECT * FROM skos_concept_relation WHERE id = $1`,
      [id],
    )
    return result.rows[0]
  }

  async getRelations(conceptId: string): Promise<SkosRelation[]> {
    const result = await this.db.query<SkosRelation>(
      `SELECT * FROM skos_concept_relation WHERE source_concept_id = $1 OR target_concept_id = $1`,
      [conceptId],
    )
    return result.rows
  }
}
