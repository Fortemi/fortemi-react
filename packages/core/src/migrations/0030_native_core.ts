import type { Migration } from '../migration-runner.js'

export const migration0030: Migration = {
  version: 30,
  name: '0030_native_core',
  sql: `
    ALTER TABLE note ADD COLUMN metadata JSONB;
    ALTER TABLE note ADD COLUMN metadata_independent BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE note ADD COLUMN created_at_utc TEXT;
    ALTER TABLE note ADD COLUMN updated_at_utc TEXT;
    ALTER TABLE note ADD COLUMN deleted_at_utc TEXT;
    ALTER TABLE note ADD COLUMN shard_deleted_at_present BOOLEAN NOT NULL DEFAULT TRUE;
    UPDATE note n SET metadata = c.ai_metadata FROM note_revised_current c WHERE c.note_id = n.id;

    -- Legacy writers used current.ai_metadata for both concepts. Explicit native
    -- metadata is independent and must not be overwritten by inference/history.
    CREATE FUNCTION project_legacy_note_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE note SET metadata = NEW.ai_metadata WHERE id = NEW.note_id AND NOT metadata_independent AND metadata IS NULL;
      ELSE
        UPDATE note SET metadata = NEW.ai_metadata WHERE id = NEW.note_id AND NOT metadata_independent
          AND metadata IS NOT DISTINCT FROM OLD.ai_metadata;
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER project_legacy_note_metadata AFTER INSERT OR UPDATE OF ai_metadata ON note_revised_current
      FOR EACH ROW EXECUTE FUNCTION project_legacy_note_metadata();
    CREATE FUNCTION mark_native_note_deleted_presence() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN NEW.shard_deleted_at_present := TRUE; END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER mark_native_note_deleted_presence BEFORE UPDATE OF deleted_at ON note
      FOR EACH ROW EXECUTE FUNCTION mark_native_note_deleted_presence();

    ALTER TABLE collection ADD COLUMN created_at_utc TEXT;
    ALTER TABLE collection ADD COLUMN shard_note_count INTEGER CHECK (shard_note_count >= 0);
    ALTER TABLE collection ALTER CONSTRAINT collection_parent_id_fkey DEFERRABLE INITIALLY DEFERRED;
    CREATE FUNCTION invalidate_native_collection_count() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP <> 'INSERT' THEN UPDATE collection SET shard_note_count = NULL WHERE id = OLD.collection_id; END IF;
      IF TG_OP <> 'DELETE' THEN UPDATE collection SET shard_note_count = NULL WHERE id = NEW.collection_id; END IF;
      RETURN NULL;
    END; $$;
    CREATE TRIGGER invalidate_native_collection_count AFTER INSERT OR UPDATE OR DELETE ON collection_note
      FOR EACH ROW EXECUTE FUNCTION invalidate_native_collection_count();

    CREATE TABLE tag (
      name TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at_utc TEXT,
      shard_export_present BOOLEAN NOT NULL DEFAULT TRUE
    );
    INSERT INTO tag (name, created_at) SELECT tag, MIN(created_at) FROM note_tag GROUP BY tag;
    ALTER TABLE note_tag ADD COLUMN position INTEGER;
    CREATE FUNCTION project_native_tag_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO tag (name, created_at) VALUES (NEW.tag, NEW.created_at) ON CONFLICT (name) DO NOTHING;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER project_native_tag_membership BEFORE INSERT OR UPDATE OF tag ON note_tag
      FOR EACH ROW EXECUTE FUNCTION project_native_tag_membership();
    ALTER TABLE note_tag ADD CONSTRAINT note_tag_catalog_fkey FOREIGN KEY (tag) REFERENCES tag(name) ON DELETE CASCADE;

    ALTER TABLE template ADD COLUMN created_at_utc TEXT;
    ALTER TABLE template ADD COLUMN updated_at_utc TEXT;
    ALTER TABLE template ADD CONSTRAINT template_collection_fkey FOREIGN KEY (collection_id)
      REFERENCES collection(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED NOT VALID;
    ALTER TABLE link ADD COLUMN metadata_json JSONB;
    ALTER TABLE link ADD COLUMN created_at_utc TEXT;
    ALTER TABLE link ALTER COLUMN confidence TYPE DOUBLE PRECISION;
    ALTER TABLE link_url_target ADD COLUMN created_at_utc TEXT;
    ALTER TABLE link_url_target ALTER COLUMN confidence TYPE DOUBLE PRECISION;
    -- Unprofiled legacy URL-only archives can contain external note handles.
    -- Their permissive table stays intact; native full-v1 apply checks its owner.
    -- Cross-table identity checks also cover ordinary writers. Existing collisions
    -- remain inspectable and are rejected by native export, not deleted on upgrade.
    CREATE FUNCTION check_native_link_identity() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_TABLE_NAME = 'link' THEN
        IF EXISTS (SELECT 1 FROM link_url_target WHERE id = NEW.id) THEN RAISE EXCEPTION 'Duplicate native link identity'; END IF;
      ELSE
        IF EXISTS (SELECT 1 FROM link WHERE id = NEW.id) THEN RAISE EXCEPTION 'Duplicate native link identity'; END IF;
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER check_native_link_identity BEFORE INSERT OR UPDATE OF id ON link
      FOR EACH ROW EXECUTE FUNCTION check_native_link_identity();
    CREATE TRIGGER check_native_link_identity BEFORE INSERT OR UPDATE OF id ON link_url_target
      FOR EACH ROW EXECUTE FUNCTION check_native_link_identity();
    CREATE FUNCTION invalidate_native_extraction_projection() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.extracted_text IS DISTINCT FROM OLD.extracted_text)
        AND NEW.extraction_status IS NOT DISTINCT FROM OLD.extraction_status
        AND NEW.extraction_reason IS NOT DISTINCT FROM OLD.extraction_reason THEN
        NEW.extraction_status := NULL;
        NEW.extraction_reason := NULL;
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER invalidate_native_extraction_projection BEFORE UPDATE OF status, extracted_text ON attachment
      FOR EACH ROW EXECUTE FUNCTION invalidate_native_extraction_projection();
    CREATE INDEX idx_note_native_metadata_provider ON note ((metadata ->> 'provider'));
    CREATE INDEX idx_note_native_metadata_model ON note ((metadata ->> 'model'));
    CREATE INDEX idx_note_native_metadata_role ON note ((metadata ->> 'role'));
    CREATE INDEX idx_note_native_metadata_event_kind ON note ((metadata ->> 'event_kind'));
    CREATE INDEX idx_note_native_metadata_sensitivity ON note ((metadata ->> 'sensitivity'));
  `,
}
