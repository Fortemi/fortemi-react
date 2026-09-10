import type { Migration } from '../migration-runner.js'

/** The historical local provenance_edge table contains activities, not derivations. */
export const migration0028: Migration = {
  version: 28,
  name: '0028_native_provenance',
  sql: `
    ALTER TABLE provenance_edge ALTER COLUMN agent DROP NOT NULL;
    ALTER TABLE provenance_edge ADD COLUMN note_id TEXT REFERENCES note(id) ON DELETE CASCADE;
    ALTER TABLE provenance_edge ADD COLUMN revision_id TEXT;
    ALTER TABLE provenance_edge ADD COLUMN started_at_utc TEXT;
    ALTER TABLE provenance_edge ADD COLUMN ended_at_utc TEXT;
    UPDATE provenance_edge p SET note_id = n.id FROM note n
      WHERE p.entity_type = 'note' AND p.entity_id = n.id;
    UPDATE provenance_edge p SET note_id = r.note_id, revision_id = r.id FROM note_revision r
      WHERE p.entity_type = 'revision' AND p.entity_id = r.id;
    CREATE INDEX idx_provenance_activity_note ON provenance_edge(note_id);
    ALTER TABLE provenance_edge ADD CONSTRAINT provenance_activity_revision_owner
      FOREIGN KEY (note_id, revision_id) REFERENCES note_revision(note_id, id)
      ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
    CREATE FUNCTION provenance_activity_owner() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE owner_note TEXT; owner_revision TEXT;
      BEGIN
        IF NEW.entity_type = 'note' THEN
          SELECT id INTO owner_note FROM note WHERE id = NEW.entity_id;
        ELSIF NEW.entity_type = 'revision' THEN
          SELECT note_id, id INTO owner_note, owner_revision FROM note_revision WHERE id = NEW.entity_id;
        END IF;
        IF TG_OP = 'INSERT' AND (
          (NEW.note_id IS NOT NULL AND NEW.note_id IS DISTINCT FROM owner_note)
          OR (NEW.revision_id IS NOT NULL AND NEW.revision_id IS DISTINCT FROM owner_revision)
        ) THEN RAISE EXCEPTION 'Provenance activity owner mismatch'; END IF;
        NEW.note_id := owner_note;
        NEW.revision_id := owner_revision;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER provenance_activity_owner_projection BEFORE INSERT OR UPDATE OF entity_type, entity_id
      ON provenance_edge FOR EACH ROW EXECUTE FUNCTION provenance_activity_owner();

    CREATE TABLE provenance_derivation (
      id TEXT PRIMARY KEY,
      revision_id TEXT REFERENCES note_revision(id) ON DELETE CASCADE,
      source_note_id TEXT REFERENCES note(id) ON DELETE CASCADE,
      source_url TEXT,
      relation TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT
    );
    CREATE INDEX idx_provenance_derivation_revision ON provenance_derivation(revision_id);
    CREATE INDEX idx_provenance_derivation_source ON provenance_derivation(source_note_id);

    CREATE TABLE named_location (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, display_name TEXT,
      location_type TEXT NOT NULL CHECK (location_type IN ('home', 'work', 'poi', 'city', 'region', 'country')),
      point JSONB, point_ewkb_hex TEXT, boundary JSONB, boundary_ewkb_hex TEXT,
      radius_m DOUBLE PRECISION, address_line TEXT, locality TEXT, admin_area TEXT, country TEXT,
      country_code TEXT, postal_code TEXT, timezone TEXT, altitude_m DOUBLE PRECISION,
      owner_id TEXT, is_private BOOLEAN DEFAULT TRUE, metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at_utc TEXT,
      CHECK (point IS NULL OR point->>'type' = 'Point'),
      CHECK (boundary IS NULL OR boundary->>'type' = 'Polygon')
    );
    CREATE INDEX idx_named_location_owner ON named_location(owner_id);
    CREATE TABLE provenance_location (
      id TEXT PRIMARY KEY, point JSONB NOT NULL, point_ewkb_hex TEXT,
      horizontal_accuracy_m DOUBLE PRECISION, altitude_m DOUBLE PRECISION, vertical_accuracy_m DOUBLE PRECISION,
      heading_degrees DOUBLE PRECISION CHECK (heading_degrees >= 0 AND heading_degrees < 360),
      speed_mps DOUBLE PRECISION CHECK (speed_mps >= 0),
      named_location_id TEXT REFERENCES named_location(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK (source IN ('gps_exif', 'device_api', 'user_manual', 'geocoded', 'ai_estimated', 'unknown')),
      confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT,
      CHECK (point->>'type' = 'Point')
    );
    CREATE INDEX idx_provenance_location_named ON provenance_location(named_location_id);
    CREATE INDEX idx_provenance_location_coordinates ON provenance_location
      (((point->'coordinates'->>0)::double precision), ((point->'coordinates'->>1)::double precision));
    CREATE TABLE provenance_device (
      id TEXT PRIMARY KEY, device_make TEXT, device_model TEXT, device_os TEXT, device_os_version TEXT,
      software TEXT, software_version TEXT, has_gps BOOLEAN, has_accelerometer BOOLEAN,
      sensor_metadata JSONB, owner_id TEXT, device_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT,
      UNIQUE NULLS NOT DISTINCT (device_make, device_model, owner_id)
    );

    CREATE FUNCTION native_tstzrange(value JSONB) RETURNS tstzrange LANGUAGE sql STABLE AS $$
      SELECT CASE
        WHEN value IS NULL OR value = 'null'::jsonb THEN NULL
        WHEN (value->>'empty')::boolean THEN 'empty'::tstzrange
        ELSE tstzrange(
          CASE WHEN (value->>'lower_infinite')::boolean THEN NULL ELSE (value->>'lower')::timestamptz END,
          CASE WHEN (value->>'upper_infinite')::boolean THEN NULL ELSE (value->>'upper')::timestamptz END,
          (CASE WHEN (value->>'lower_inclusive')::boolean THEN '[' ELSE '(' END)
            || (CASE WHEN (value->>'upper_inclusive')::boolean THEN ']' ELSE ')' END)
        ) END;
    $$;
    CREATE FUNCTION native_tstzrange_json(value tstzrange) RETURNS JSONB LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN value IS NULL THEN NULL ELSE jsonb_build_object(
        'empty', isempty(value),
        'lower', to_char(lower(value) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'upper', to_char(upper(value) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'lower_inclusive', lower_inc(value), 'upper_inclusive', upper_inc(value),
        'lower_infinite', lower_inf(value), 'upper_infinite', upper_inf(value)
      ) END;
    $$;
    CREATE TABLE provenance_record (
      id TEXT PRIMARY KEY,
      attachment_id TEXT REFERENCES attachment(id) ON DELETE CASCADE,
      note_id TEXT UNIQUE REFERENCES note(id) ON DELETE CASCADE,
      capture_time tstzrange, capture_time_source JSONB, capture_timezone TEXT,
      capture_duration_seconds DOUBLE PRECISION, time_source TEXT, time_confidence TEXT,
      location_id TEXT REFERENCES provenance_location(id) ON DELETE SET NULL,
      device_id TEXT REFERENCES provenance_device(id) ON DELETE SET NULL,
      activity_id TEXT REFERENCES provenance_edge(id) ON DELETE SET NULL,
      event_type TEXT, event_title TEXT, event_description TEXT, raw_metadata JSONB, ai_context JSONB,
      ai_processed_at TIMESTAMPTZ, ai_processed_at_utc TEXT, ai_model TEXT, user_corrected BOOLEAN,
      original_capture_time tstzrange, original_capture_time_source JSONB,
      original_location_id TEXT REFERENCES provenance_location(id) ON DELETE SET NULL,
      correction_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at_utc TEXT,
      CHECK (note_id IS NOT NULL OR attachment_id IS NOT NULL)
    );
    CREATE INDEX idx_provenance_record_capture_time ON provenance_record USING gist(capture_time);
    CREATE INDEX idx_provenance_record_attachment ON provenance_record(attachment_id);
  `,
}
