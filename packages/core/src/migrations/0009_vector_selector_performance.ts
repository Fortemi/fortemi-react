/**
 * Migration 0009: Indexes for property-scoped vector selectors.
 */

import type { Migration } from '../migration-runner.js'

export const migration0009: Migration = {
  version: 9,
  name: '0009_vector_selector_performance',
  sql: `
    CREATE INDEX IF NOT EXISTS idx_embedding_set_kind ON embedding_set(kind);
    CREATE INDEX IF NOT EXISTS idx_embedding_set_member_set ON embedding_set_member(embedding_set_id);
    CREATE INDEX IF NOT EXISTS idx_embedding_set_member_note ON embedding_set_member(note_id);
    CREATE INDEX IF NOT EXISTS idx_embedding_set_member_embedding ON embedding_set_member(embedding_id);

    CREATE INDEX IF NOT EXISTS idx_note_source ON note(source);
    CREATE INDEX IF NOT EXISTS idx_note_format ON note(format);
    CREATE INDEX IF NOT EXISTS idx_note_visibility ON note(visibility);
    CREATE INDEX IF NOT EXISTS idx_note_starred ON note(is_starred);
    CREATE INDEX IF NOT EXISTS idx_note_archived ON note(is_archived);
    CREATE INDEX IF NOT EXISTS idx_note_updated_at ON note(updated_at);

    CREATE INDEX IF NOT EXISTS idx_note_revised_current_user_edited ON note_revised_current(is_user_edited);
    CREATE INDEX IF NOT EXISTS idx_note_revised_current_generation_count ON note_revised_current(generation_count);
  `,
}
