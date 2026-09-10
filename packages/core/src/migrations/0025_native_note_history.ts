/** Native revision state for full-v1 restore; no archival record storage. */

import type { Migration } from '../migration-runner.js'

export const migration0025: Migration = {
  version: 25,
  name: '0025_native_note_history',
  sql: `
    -- The producer keys current originals by note_id; its id is nullable and
    -- is not globally unique. A duplicate legacy owner fails this migration
    -- atomically rather than selecting or deleting an original arbitrarily.
    ALTER TABLE note_original DROP CONSTRAINT note_original_pkey;
    ALTER TABLE note_original ADD PRIMARY KEY (note_id);
    ALTER TABLE note_original ALTER COLUMN id DROP NOT NULL;
    ALTER TABLE note_original ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number > 0);
    ALTER TABLE note_original ADD COLUMN user_created_at TEXT;
    ALTER TABLE note_original ADD COLUMN user_last_edited_at TEXT;
    ALTER TABLE note_original ADD COLUMN shard_export_present BOOLEAN NOT NULL DEFAULT TRUE;
    UPDATE note_original SET
      user_created_at = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      user_last_edited_at = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    ALTER TABLE note_original ALTER COLUMN user_created_at
      SET DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    ALTER TABLE note_original ALTER COLUMN user_last_edited_at
      SET DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

    CREATE TABLE note_original_history (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK (version_number > 0),
      content TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE (note_id, version_number)
    );

    ALTER TABLE note_revision ADD COLUMN parent_revision_id TEXT;
    ALTER TABLE note_revision ADD COLUMN summary TEXT;
    ALTER TABLE note_revision ADD COLUMN rationale TEXT;
    -- Scalar wire timestamps retain precision beyond PostgreSQL/JS dates.
    -- created_at remains the existing repository's queryable instant.
    ALTER TABLE note_revision ADD COLUMN created_at_utc TEXT;
    ALTER TABLE note_revision ADD COLUMN ai_generated_at TEXT;
    ALTER TABLE note_revision ADD COLUMN user_last_edited_at TEXT;
    ALTER TABLE note_revision ADD COLUMN is_user_edited BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE note_revision ADD COLUMN generation_count INTEGER NOT NULL DEFAULT 1 CHECK (generation_count > 0);
    ALTER TABLE note_revision ADD COLUMN shard_export_present BOOLEAN NOT NULL DEFAULT TRUE;
    UPDATE note_revision SET
      summary = CASE WHEN jsonb_typeof(ai_metadata->'summary') = 'string' THEN ai_metadata->>'summary' END,
      rationale = CASE WHEN jsonb_typeof(ai_metadata->'rationale') = 'string' THEN ai_metadata->>'rationale' END,
      is_user_edited = (ai_metadata->'is_user_edited' = 'true'::jsonb) IS TRUE OR type = 'user',
      generation_count = greatest(1, revision_number);
    UPDATE note_revision SET
      ai_generated_at = CASE WHEN NOT is_user_edited THEN to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
      user_last_edited_at = CASE WHEN is_user_edited THEN to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END;
    WITH ordered AS (
      SELECT id, lag(id) OVER (PARTITION BY note_id ORDER BY revision_number) AS parent_id FROM note_revision
    ) UPDATE note_revision r SET parent_revision_id = ordered.parent_id FROM ordered WHERE r.id = ordered.id;
    ALTER TABLE note_revision ADD CONSTRAINT note_revision_id_owner UNIQUE (note_id, id);
    ALTER TABLE note_revision ADD CONSTRAINT note_revision_parent_owner
      FOREIGN KEY (note_id, parent_revision_id) REFERENCES note_revision(note_id, id)
      DEFERRABLE INITIALLY DEFERRED;

    ALTER TABLE note_revised_current ADD COLUMN last_revision_id TEXT;
    ALTER TABLE note_revised_current ADD COLUMN shard_export_present BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE note_revised_current ADD CONSTRAINT note_revised_current_revision_owner
      FOREIGN KEY (note_id, last_revision_id) REFERENCES note_revision(note_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  `,
}
