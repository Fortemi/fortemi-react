/**
 * Tests for SkosRepository.
 *
 * Covers:
 * - createScheme: inserts scheme row with optional description
 * - listSchemes: returns active schemes, excludes soft-deleted
 * - deleteScheme: soft-deletes scheme
 * - createConcept: inserts concept with pref_label, alt_labels, definition
 * - listConcepts: returns active concepts for scheme
 * - deleteConcept: soft-deletes concept
 * - createRelation: broader/narrower/related relation creation
 * - getRelations: returns all relations for a concept
 * - relation_type constraint: DB rejects invalid types
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { SkosRepository } from '../repositories/skos-repository.js'

// ── helpers ───────────────────────────────────────────────────────────────────

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

// ── suite ──────────────────────────────────────────────────────────────────────

describe('SkosRepository', () => {
  let db: PGlite
  let repo: SkosRepository

  beforeEach(async () => {
    db = await setupDb()
    repo = new SkosRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  // ── createScheme ───────────────────────────────────────────────────────────

  describe('createScheme', () => {
    it('creates a scheme and returns a SkosScheme', async () => {
      const scheme = await repo.createScheme('Programming Languages')
      expect(scheme.id).toBeTruthy()
      expect(scheme.title).toBe('Programming Languages')
      expect(scheme.description).toBeNull()
      expect(scheme.deleted_at).toBeNull()
    })

    it('stores description when provided', async () => {
      const scheme = await repo.createScheme('Science', 'Natural science topics')
      expect(scheme.description).toBe('Natural science topics')
    })
  })

  // ── listSchemes ────────────────────────────────────────────────────────────

  describe('listSchemes', () => {
    it('returns empty array when no schemes exist', async () => {
      const schemes = await repo.listSchemes()
      expect(schemes).toEqual([])
    })

    it('returns all active schemes ordered by title', async () => {
      await repo.createScheme('Zebra')
      await repo.createScheme('Alpha')
      const schemes = await repo.listSchemes()
      expect(schemes).toHaveLength(2)
      expect(schemes[0].title).toBe('Alpha')
      expect(schemes[1].title).toBe('Zebra')
    })

    it('excludes soft-deleted schemes', async () => {
      const scheme = await repo.createScheme('Gone')
      await repo.deleteScheme(scheme.id)
      const schemes = await repo.listSchemes()
      expect(schemes).toHaveLength(0)
    })
  })

  // ── deleteScheme ───────────────────────────────────────────────────────────

  describe('deleteScheme', () => {
    it('soft-deletes the scheme', async () => {
      const scheme = await repo.createScheme('ToDelete')
      await repo.deleteScheme(scheme.id)
      const schemes = await repo.listSchemes()
      expect(schemes.find((s) => s.id === scheme.id)).toBeUndefined()
    })
  })

  // ── createConcept ──────────────────────────────────────────────────────────

  describe('createConcept', () => {
    it('creates a concept with required fields only', async () => {
      const scheme = await repo.createScheme('Tech')
      const concept = await repo.createConcept(scheme.id, 'Rust')
      expect(concept.id).toBeTruthy()
      expect(concept.scheme_id).toBe(scheme.id)
      expect(concept.pref_label).toBe('Rust')
      expect(concept.definition).toBeNull()
      expect(concept.deleted_at).toBeNull()
    })

    it('stores alt_labels when provided', async () => {
      const scheme = await repo.createScheme('Tech')
      const concept = await repo.createConcept(scheme.id, 'JavaScript', {
        altLabels: ['JS', 'ECMAScript'],
      })
      // alt_labels is stored as JSONB — PGlite may return parsed array or string
      const labels = Array.isArray(concept.alt_labels)
        ? concept.alt_labels
        : JSON.parse(concept.alt_labels as unknown as string)
      expect(labels).toContain('JS')
      expect(labels).toContain('ECMAScript')
    })

    it('stores definition when provided', async () => {
      const scheme = await repo.createScheme('Tech')
      const concept = await repo.createConcept(scheme.id, 'Rust', {
        definition: 'A systems programming language',
      })
      expect(concept.definition).toBe('A systems programming language')
    })
  })

  // ── listConcepts ───────────────────────────────────────────────────────────

  describe('listConcepts', () => {
    it('returns empty array when scheme has no concepts', async () => {
      const scheme = await repo.createScheme('Empty')
      const concepts = await repo.listConcepts(scheme.id)
      expect(concepts).toEqual([])
    })

    it('returns active concepts ordered by pref_label', async () => {
      const scheme = await repo.createScheme('Tech')
      await repo.createConcept(scheme.id, 'Zebra')
      await repo.createConcept(scheme.id, 'Alpha')
      const concepts = await repo.listConcepts(scheme.id)
      expect(concepts[0].pref_label).toBe('Alpha')
      expect(concepts[1].pref_label).toBe('Zebra')
    })

    it('excludes soft-deleted concepts', async () => {
      const scheme = await repo.createScheme('Tech')
      const concept = await repo.createConcept(scheme.id, 'Gone')
      await repo.deleteConcept(concept.id)
      const concepts = await repo.listConcepts(scheme.id)
      expect(concepts).toHaveLength(0)
    })

    it('only returns concepts for the requested scheme', async () => {
      const schemeA = await repo.createScheme('A')
      const schemeB = await repo.createScheme('B')
      await repo.createConcept(schemeA.id, 'InA')
      await repo.createConcept(schemeB.id, 'InB')
      const conceptsA = await repo.listConcepts(schemeA.id)
      expect(conceptsA).toHaveLength(1)
      expect(conceptsA[0].pref_label).toBe('InA')
    })
  })

  // ── deleteConcept ──────────────────────────────────────────────────────────

  describe('deleteConcept', () => {
    it('soft-deletes the concept', async () => {
      const scheme = await repo.createScheme('Tech')
      const concept = await repo.createConcept(scheme.id, 'ToDelete')
      await repo.deleteConcept(concept.id)
      const concepts = await repo.listConcepts(scheme.id)
      expect(concepts.find((c) => c.id === concept.id)).toBeUndefined()
    })
  })

  // ── createRelation ─────────────────────────────────────────────────────────

  describe('createRelation', () => {
    it('creates a broader relation', async () => {
      const scheme = await repo.createScheme('Tech')
      const parent = await repo.createConcept(scheme.id, 'Language')
      const child = await repo.createConcept(scheme.id, 'Rust')
      const rel = await repo.createRelation(child.id, parent.id, 'broader')
      expect(rel.id).toBeTruthy()
      expect(rel.source_concept_id).toBe(child.id)
      expect(rel.target_concept_id).toBe(parent.id)
      expect(rel.relation_type).toBe('broader')
    })

    it('creates a narrower relation', async () => {
      const scheme = await repo.createScheme('Tech')
      const parent = await repo.createConcept(scheme.id, 'Language')
      const child = await repo.createConcept(scheme.id, 'Rust')
      const rel = await repo.createRelation(parent.id, child.id, 'narrower')
      expect(rel.relation_type).toBe('narrower')
    })

    it('creates a related relation', async () => {
      const scheme = await repo.createScheme('Tech')
      const a = await repo.createConcept(scheme.id, 'Rust')
      const b = await repo.createConcept(scheme.id, 'Go')
      const rel = await repo.createRelation(a.id, b.id, 'related')
      expect(rel.relation_type).toBe('related')
    })

    it('DB rejects an invalid relation_type', async () => {
      const scheme = await repo.createScheme('Tech')
      const a = await repo.createConcept(scheme.id, 'Rust')
      const b = await repo.createConcept(scheme.id, 'Go')
      await expect(
        db.query(
          `INSERT INTO skos_concept_relation (id, source_concept_id, target_concept_id, relation_type)
           VALUES ('rel-bad', $1, $2, 'invalid')`,
          [a.id, b.id],
        ),
      ).rejects.toThrow()
    })
  })

  // ── getRelations ───────────────────────────────────────────────────────────

  describe('getRelations', () => {
    it('returns empty array when concept has no relations', async () => {
      const scheme = await repo.createScheme('Tech')
      const concept = await repo.createConcept(scheme.id, 'Isolated')
      const relations = await repo.getRelations(concept.id)
      expect(relations).toEqual([])
    })

    it('returns relations where concept is source', async () => {
      const scheme = await repo.createScheme('Tech')
      const a = await repo.createConcept(scheme.id, 'A')
      const b = await repo.createConcept(scheme.id, 'B')
      await repo.createRelation(a.id, b.id, 'broader')
      const relations = await repo.getRelations(a.id)
      expect(relations).toHaveLength(1)
    })

    it('returns relations where concept is target', async () => {
      const scheme = await repo.createScheme('Tech')
      const a = await repo.createConcept(scheme.id, 'A')
      const b = await repo.createConcept(scheme.id, 'B')
      await repo.createRelation(a.id, b.id, 'broader')
      const relations = await repo.getRelations(b.id)
      expect(relations).toHaveLength(1)
    })

    it('returns all relations when concept is both source and target of different relations', async () => {
      const scheme = await repo.createScheme('Tech')
      const a = await repo.createConcept(scheme.id, 'A')
      const b = await repo.createConcept(scheme.id, 'B')
      const c = await repo.createConcept(scheme.id, 'C')
      await repo.createRelation(a.id, b.id, 'broader')
      await repo.createRelation(c.id, a.id, 'narrower')
      const relations = await repo.getRelations(a.id)
      expect(relations).toHaveLength(2)
    })
  })
})
