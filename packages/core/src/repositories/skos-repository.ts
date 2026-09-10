/**
 * SkosRepository — SKOS taxonomy management (schemes, concepts, relations).
 *
 * Responsibilities:
 * - Create and soft-delete SKOS schemes (taxonomy containers)
 * - Create, list, and soft-delete SKOS concepts within schemes
 * - Create and query broader/narrower/related concept relations
 */

import type { DatabaseClient } from '../storage-backend.js'
import { generateId } from '../uuid.js'
import { readNativeSkosComponent, type NativeSkosScheme, type NativeSkosConcept, type NativeSkosRelation,
  type NativeNoteSkosTag, type NativeSkosLabel, type NativeSkosNote, type NativeSkosMapping,
  type NativeSkosMembership, type NativeSkosCollection, type NativeSkosCollectionMember } from '../shard/native-skos.js'

export type { NativeSkosLabel as SkosLabel, NativeSkosNote as SkosNote, NativeSkosMapping as SkosMapping,
  NativeSkosMembership as SkosMembership, NativeSkosCollection as SkosCollection,
  NativeSkosCollectionMember as SkosCollectionMember, NativeSkosScheme as SkosSchemeRecord,
  NativeSkosConcept as SkosConceptRecord, NativeNoteSkosTag as NoteSkosAssignment } from '../shard/native-skos.js'

export interface SkosScheme extends Partial<Omit<NativeSkosScheme, 'created_at' | 'updated_at' | 'issued_at' | 'modified_at' | 'embedded_at' | 'embedding'>> {
  id: string
  title: string
  description: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface SkosConcept extends Partial<Omit<NativeSkosConcept, 'primary_scheme_id' | 'created_at' | 'updated_at' | 'promoted_at' | 'deprecated_at' | 'first_used_at' | 'last_used_at' | 'antipattern_checked_at' | 'embedded_at' | 'embedding'>> {
  id: string
  scheme_id: string
  pref_label: string
  alt_labels: string[]
  definition: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface SkosRelation extends Partial<Omit<NativeSkosRelation, 'subject_id' | 'object_id' | 'created_at' | 'relation_type'>> {
  id: string
  source_concept_id: string
  target_concept_id: string
  relation_type: string
  created_at: Date
}

export interface NoteSkosTag extends Partial<Omit<NativeNoteSkosTag, 'created_at'>> {
  id: string
  note_id: string
  concept_id: string
  created_at: Date
}

export class SkosRepository {
  constructor(private db: DatabaseClient) {}

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
    return this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO skos_concept (id, scheme_id, pref_label) VALUES ($1, $2, $3)`, [id, schemeId, prefLabel])
      await tx.query(`INSERT INTO skos_concept_label (id, concept_id, label_type, value) VALUES ($1, $2, 'pref_label', $3)`,
        [generateId(), id, prefLabel])
      for (const value of options?.altLabels ?? []) {
        await tx.query(`INSERT INTO skos_concept_label (id, concept_id, label_type, value) VALUES ($1, $2, 'alt_label', $3)`,
          [generateId(), id, value])
      }
      if (options?.definition !== undefined) {
        await tx.query(`INSERT INTO skos_concept_note (id, concept_id, note_type, value) VALUES ($1, $2, 'definition', $3)`,
          [generateId(), id, options.definition])
      }
      await tx.query('INSERT INTO skos_scheme_membership (concept_id, scheme_id) VALUES ($1, $2)', [id, schemeId])
      return (await tx.query<SkosConcept>('SELECT * FROM skos_concept WHERE id = $1', [id])).rows[0]
    })
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

  // ── Note tagging ───────────────────────────────────────────────────────────

  async tagNote(noteId: string, conceptId: string): Promise<NoteSkosTag> {
    const existing = await this.db.query<NoteSkosTag>(
      `SELECT * FROM note_skos_tag WHERE note_id = $1 AND concept_id = $2`,
      [noteId, conceptId],
    )
    if (existing.rows.length > 0) return existing.rows[0]

    const id = generateId()
    await this.db.query(
      `INSERT INTO note_skos_tag (id, note_id, concept_id) VALUES ($1, $2, $3)`,
      [id, noteId, conceptId],
    )
    const result = await this.db.query<NoteSkosTag>(`SELECT * FROM note_skos_tag WHERE id = $1`, [id])
    return result.rows[0]
  }

  async untagNote(noteId: string, conceptId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM note_skos_tag WHERE note_id = $1 AND concept_id = $2`,
      [noteId, conceptId],
    )
  }

  async conceptsForNote(noteId: string): Promise<SkosConcept[]> {
    const result = await this.db.query<SkosConcept>(
      `SELECT c.*
       FROM skos_concept c
       INNER JOIN note_skos_tag nst ON nst.concept_id = c.id
       WHERE nst.note_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.pref_label`,
      [noteId],
    )
    return result.rows
  }

  async getSchemeRecord(id: string): Promise<NativeSkosScheme | null> {
    return (await readNativeSkosComponent(this.db, 'skos_schemes', { id }))[0] ?? null
  }

  async getConceptRecord(id: string): Promise<NativeSkosConcept | null> {
    return (await readNativeSkosComponent(this.db, 'skos_concepts', { id }))[0] ?? null
  }

  async getLabels(conceptId: string): Promise<NativeSkosLabel[]> {
    return readNativeSkosComponent(this.db, 'skos_labels', { concept_id: conceptId })
  }

  async getNotes(conceptId: string): Promise<NativeSkosNote[]> {
    return readNativeSkosComponent(this.db, 'skos_notes', { concept_id: conceptId })
  }

  async getMappings(conceptId: string): Promise<NativeSkosMapping[]> {
    return readNativeSkosComponent(this.db, 'skos_mapping_relations', { concept_id: conceptId })
  }

  async getSchemeMemberships(conceptId: string): Promise<NativeSkosMembership[]> {
    return readNativeSkosComponent(this.db, 'skos_scheme_memberships', { concept_id: conceptId })
  }

  async getAssignments(noteId: string): Promise<NativeNoteSkosTag[]> {
    return readNativeSkosComponent(this.db, 'note_skos_tags', { note_id: noteId })
  }

  async listCollections(schemeId?: string): Promise<NativeSkosCollection[]> {
    return readNativeSkosComponent(this.db, 'skos_collections', schemeId === undefined ? {} : { scheme_id: schemeId })
  }

  async getCollectionMembers(collectionId: string): Promise<NativeSkosCollectionMember[]> {
    const rows = await readNativeSkosComponent(this.db, 'skos_collection_members', { collection_id: collectionId })
    return rows.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.concept_id.localeCompare(b.concept_id))
  }
}
