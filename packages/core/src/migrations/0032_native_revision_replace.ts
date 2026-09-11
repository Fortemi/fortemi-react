import type { Migration } from '../migration-runner.js'

export const migration0032: Migration = {
  version: 32,
  name: '0032_native_revision_replace',
  sql: `
    ALTER TABLE note_revision DROP CONSTRAINT note_revision_note_id_revision_number_key;
    ALTER TABLE note_revision ADD CONSTRAINT note_revision_note_id_revision_number_key
      UNIQUE (note_id, revision_number) DEFERRABLE INITIALLY DEFERRED;
  `,
}
