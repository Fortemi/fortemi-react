/**
 * Migration 0002: SKOS tagging schema.
 * Creates: skos_scheme, skos_concept, skos_concept_relation,
 *          note_tag, note_skos_tag.
 */

import type { Migration } from '../migration-runner.js'

export const migration0002: Migration = {
  version: 2,
  name: '0002_skos_tagging',
  sql: `
    -- SKOS Scheme (taxonomy container)
    CREATE TABLE IF NOT EXISTS skos_scheme (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    -- SKOS Concept (individual taxonomy term)
    CREATE TABLE IF NOT EXISTS skos_concept (
      id TEXT PRIMARY KEY,
      scheme_id TEXT NOT NULL REFERENCES skos_scheme(id),
      pref_label TEXT NOT NULL,
      alt_labels JSONB DEFAULT '[]',
      definition TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_skos_concept_scheme ON skos_concept(scheme_id);

    -- SKOS Concept Relation (broader/narrower/related)
    CREATE TABLE IF NOT EXISTS skos_concept_relation (
      id TEXT PRIMARY KEY,
      source_concept_id TEXT NOT NULL REFERENCES skos_concept(id),
      target_concept_id TEXT NOT NULL REFERENCES skos_concept(id),
      relation_type TEXT NOT NULL CHECK (relation_type IN ('broader', 'narrower', 'related')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_skos_relation_source ON skos_concept_relation(source_concept_id);
    CREATE INDEX IF NOT EXISTS idx_skos_relation_target ON skos_concept_relation(target_concept_id);

    -- Note tag (free-form tags)
    CREATE TABLE IF NOT EXISTS note_tag (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      tag TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (note_id, tag)
    );

    CREATE INDEX IF NOT EXISTS idx_note_tag_note ON note_tag(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_tag_tag ON note_tag(tag);

    -- Note SKOS tag (structured taxonomy tags)
    CREATE TABLE IF NOT EXISTS note_skos_tag (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      concept_id TEXT NOT NULL REFERENCES skos_concept(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (note_id, concept_id)
    );

    CREATE INDEX IF NOT EXISTS idx_note_skos_tag_note ON note_skos_tag(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_skos_tag_concept ON note_skos_tag(concept_id);
  `,
}
