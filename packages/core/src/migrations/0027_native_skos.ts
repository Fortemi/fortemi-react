import type { Migration } from '../migration-runner.js'

/** Native SKOS records. Legacy flattened text becomes real language-bearing rows. */
export const migration0027: Migration = {
  version: 27,
  name: '0027_native_skos',
  sql: `
    ALTER TABLE skos_scheme ADD COLUMN uri TEXT;
    ALTER TABLE skos_scheme ADD COLUMN notation TEXT;
    UPDATE skos_scheme SET notation = id;
    ALTER TABLE skos_scheme ALTER COLUMN notation SET NOT NULL;
    CREATE FUNCTION skos_scheme_default_notation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.notation := COALESCE(NEW.notation, NEW.id); RETURN NEW; END;
    $$;
    CREATE TRIGGER skos_scheme_notation BEFORE INSERT ON skos_scheme
      FOR EACH ROW EXECUTE FUNCTION skos_scheme_default_notation();
    ALTER TABLE skos_scheme ADD COLUMN creator TEXT;
    ALTER TABLE skos_scheme ADD COLUMN publisher TEXT;
    ALTER TABLE skos_scheme ADD COLUMN rights TEXT;
    ALTER TABLE skos_scheme ADD COLUMN version TEXT;
    ALTER TABLE skos_scheme ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE skos_scheme ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE skos_scheme ADD COLUMN created_at_utc TEXT;
    ALTER TABLE skos_scheme ADD COLUMN updated_at_utc TEXT;
    ALTER TABLE skos_scheme ADD COLUMN issued_at TIMESTAMPTZ;
    ALTER TABLE skos_scheme ADD COLUMN issued_at_utc TEXT;
    ALTER TABLE skos_scheme ADD COLUMN modified_at TIMESTAMPTZ;
    ALTER TABLE skos_scheme ADD COLUMN modified_at_utc TEXT;
    ALTER TABLE skos_scheme ADD COLUMN embedding vector(768);
    ALTER TABLE skos_scheme ADD COLUMN embedding_values DOUBLE PRECISION[];
    ALTER TABLE skos_scheme ADD COLUMN embedding_model TEXT;
    ALTER TABLE skos_scheme ADD COLUMN embedded_at TIMESTAMPTZ;
    ALTER TABLE skos_scheme ADD COLUMN embedded_at_utc TEXT;

    ALTER TABLE skos_concept ADD COLUMN uri TEXT;
    ALTER TABLE skos_concept ADD COLUMN notation TEXT;
    ALTER TABLE skos_concept ADD COLUMN facet_type TEXT CHECK (facet_type IN ('personality', 'matter', 'energy', 'space', 'time'));
    ALTER TABLE skos_concept ADD COLUMN facet_source TEXT;
    ALTER TABLE skos_concept ADD COLUMN facet_domain TEXT;
    ALTER TABLE skos_concept ADD COLUMN facet_scope TEXT;
    ALTER TABLE skos_concept ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'
      CHECK (status IN ('candidate', 'approved', 'deprecated', 'obsolete'));
    ALTER TABLE skos_concept ADD COLUMN promoted_at TIMESTAMPTZ;
    ALTER TABLE skos_concept ADD COLUMN promoted_at_utc TEXT;
    ALTER TABLE skos_concept ADD COLUMN deprecated_at TIMESTAMPTZ;
    ALTER TABLE skos_concept ADD COLUMN deprecated_at_utc TEXT;
    ALTER TABLE skos_concept ADD COLUMN deprecation_reason TEXT;
    ALTER TABLE skos_concept ADD COLUMN replaced_by_id TEXT REFERENCES skos_concept(id) DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE skos_concept ADD COLUMN note_count INTEGER NOT NULL DEFAULT 0 CHECK (note_count >= 0);
    ALTER TABLE skos_concept ADD COLUMN first_used_at TIMESTAMPTZ;
    ALTER TABLE skos_concept ADD COLUMN first_used_at_utc TEXT;
    ALTER TABLE skos_concept ADD COLUMN last_used_at TIMESTAMPTZ;
    ALTER TABLE skos_concept ADD COLUMN last_used_at_utc TEXT;
    ALTER TABLE skos_concept ADD COLUMN depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5);
    ALTER TABLE skos_concept ADD COLUMN broader_count INTEGER NOT NULL DEFAULT 0 CHECK (broader_count BETWEEN 0 AND 3);
    ALTER TABLE skos_concept ADD COLUMN narrower_count INTEGER NOT NULL DEFAULT 0 CHECK (narrower_count >= 0);
    ALTER TABLE skos_concept ADD COLUMN related_count INTEGER NOT NULL DEFAULT 0 CHECK (related_count >= 0);
    ALTER TABLE skos_concept ADD COLUMN antipatterns TEXT[];
    ALTER TABLE skos_concept ADD COLUMN antipattern_checked_at TIMESTAMPTZ;
    ALTER TABLE skos_concept ADD COLUMN antipattern_checked_at_utc TEXT;
    ALTER TABLE skos_concept ADD COLUMN created_at_utc TEXT;
    ALTER TABLE skos_concept ADD COLUMN updated_at_utc TEXT;
    ALTER TABLE skos_concept ADD COLUMN embedding vector(768);
    ALTER TABLE skos_concept ADD COLUMN embedding_values DOUBLE PRECISION[];
    ALTER TABLE skos_concept ADD COLUMN embedding_model TEXT;
    ALTER TABLE skos_concept ADD COLUMN embedded_at TIMESTAMPTZ;
    ALTER TABLE skos_concept ADD COLUMN embedded_at_utc TEXT;

    CREATE TABLE skos_concept_label (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL REFERENCES skos_concept(id),
      label_type TEXT NOT NULL CHECK (label_type IN ('pref_label', 'alt_label', 'hidden_label')),
      value TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT
    );
    CREATE INDEX idx_skos_label_concept ON skos_concept_label(concept_id);
    CREATE TABLE skos_concept_note (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL REFERENCES skos_concept(id),
      note_type TEXT NOT NULL CHECK (note_type IN ('definition', 'scope_note', 'example', 'history_note', 'editorial_note', 'change_note', 'note')),
      value TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', author TEXT, source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at_utc TEXT
    );
    CREATE INDEX idx_skos_note_concept ON skos_concept_note(concept_id);
    ALTER TABLE skos_concept_relation ADD COLUMN inference_score DOUBLE PRECISION;
    ALTER TABLE skos_concept_relation ADD COLUMN is_inferred BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE skos_concept_relation ADD COLUMN is_validated BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE skos_concept_relation ADD COLUMN created_by TEXT;
    ALTER TABLE skos_concept_relation ADD COLUMN created_at_utc TEXT;

    CREATE TABLE skos_mapping_relation (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL REFERENCES skos_concept(id),
      target_uri TEXT NOT NULL, target_scheme_uri TEXT, target_label TEXT,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('exact_match', 'close_match', 'broad_match', 'narrow_match', 'related_match')),
      confidence DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1), is_validated BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT,
      validated_at TIMESTAMPTZ, validated_at_utc TEXT, validated_by TEXT
    );
    CREATE INDEX idx_skos_mapping_concept ON skos_mapping_relation(concept_id);
    CREATE TABLE skos_scheme_membership (
      concept_id TEXT NOT NULL REFERENCES skos_concept(id), scheme_id TEXT NOT NULL REFERENCES skos_scheme(id),
      is_top_concept BOOLEAN NOT NULL DEFAULT FALSE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(), added_at_utc TEXT,
      PRIMARY KEY (concept_id, scheme_id)
    );
    CREATE INDEX idx_skos_membership_scheme ON skos_scheme_membership(scheme_id);
    ALTER TABLE note_skos_tag ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE note_skos_tag ADD COLUMN confidence DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1);
    ALTER TABLE note_skos_tag ADD COLUMN relevance_score DOUBLE PRECISION CHECK (relevance_score BETWEEN 0 AND 1);
    ALTER TABLE note_skos_tag ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE note_skos_tag ADD COLUMN created_by TEXT;
    ALTER TABLE note_skos_tag ADD COLUMN created_at_utc TEXT;

    CREATE TABLE skos_collection (
      id TEXT PRIMARY KEY, uri TEXT, pref_label TEXT NOT NULL, definition TEXT,
      is_ordered BOOLEAN NOT NULL DEFAULT FALSE, scheme_id TEXT REFERENCES skos_scheme(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at_utc TEXT
    );
    CREATE TABLE skos_collection_member (
      collection_id TEXT NOT NULL REFERENCES skos_collection(id), concept_id TEXT NOT NULL REFERENCES skos_concept(id),
      position INTEGER CHECK (position >= 0), added_at TIMESTAMPTZ NOT NULL DEFAULT now(), added_at_utc TEXT,
      PRIMARY KEY (collection_id, concept_id)
    );
    CREATE INDEX idx_skos_collection_member_concept ON skos_collection_member(concept_id);

    -- Legacy text is retained, including empty values that a future full-v1
    -- exporter must reject explicitly instead of silently discarding.
    -- PostgreSQL 17 lacks uuidv7(); retain the CSPRNG's 74 random bits and
    -- variant while supplying the millisecond prefix and version for backfill.
    CREATE FUNCTION skos_backfill_uuid7() RETURNS TEXT LANGUAGE sql VOLATILE AS $$
      SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0')
        || '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14))::uuid::text;
    $$;
    INSERT INTO skos_concept_label (id, concept_id, label_type, value, created_at)
      SELECT skos_backfill_uuid7(), id, 'pref_label', pref_label, created_at FROM skos_concept;
    INSERT INTO skos_concept_label (id, concept_id, label_type, value, created_at)
      SELECT skos_backfill_uuid7(), c.id, 'alt_label', a.value, c.created_at
      FROM skos_concept c CROSS JOIN LATERAL jsonb_array_elements_text(c.alt_labels) a(value);
    INSERT INTO skos_concept_note (id, concept_id, note_type, value, created_at, updated_at)
      SELECT skos_backfill_uuid7(), id, 'definition', definition, created_at, updated_at
      FROM skos_concept WHERE definition IS NOT NULL;
    INSERT INTO skos_scheme_membership (concept_id, scheme_id, added_at)
      SELECT id, scheme_id, created_at FROM skos_concept;
    DROP FUNCTION skos_backfill_uuid7();

    CREATE FUNCTION refresh_skos_concept_display(owner_id TEXT) RETURNS void LANGUAGE sql AS $$
      UPDATE skos_concept c SET
        pref_label = COALESCE((SELECT value FROM skos_concept_label WHERE concept_id = c.id AND label_type = 'pref_label'
          ORDER BY (language = 'en') DESC, language, id LIMIT 1), c.notation, c.id),
        alt_labels = COALESCE((SELECT jsonb_agg(value ORDER BY language, id) FROM skos_concept_label
          WHERE concept_id = c.id AND label_type = 'alt_label'), '[]'::jsonb),
        definition = (SELECT value FROM skos_concept_note WHERE concept_id = c.id AND note_type = 'definition'
          ORDER BY (language = 'en') DESC, language, id LIMIT 1)
      WHERE c.id = owner_id;
    $$;
    CREATE FUNCTION skos_refresh_display_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP <> 'INSERT' THEN PERFORM refresh_skos_concept_display(OLD.concept_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM refresh_skos_concept_display(NEW.concept_id); END IF;
        RETURN NULL;
      END;
    $$;
    CREATE TRIGGER skos_label_display AFTER INSERT OR UPDATE OR DELETE ON skos_concept_label
      FOR EACH ROW EXECUTE FUNCTION skos_refresh_display_trigger();
    CREATE TRIGGER skos_note_display AFTER INSERT OR UPDATE OR DELETE ON skos_concept_note
      FOR EACH ROW EXECUTE FUNCTION skos_refresh_display_trigger();
  `,
}
