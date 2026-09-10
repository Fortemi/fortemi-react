import type { Migration } from '../migration-runner.js'

export const migration0029: Migration = {
  version: 29,
  name: '0029_native_graph',
  sql: `
    ALTER TABLE graph_source ADD COLUMN created_at_utc TEXT;
    ALTER TABLE community_set ADD COLUMN created_at_utc TEXT;
    ALTER TABLE community ADD COLUMN position INTEGER CHECK (position IS NULL OR position >= 0);
    WITH ordered AS (
      SELECT community_set_id, id,
        (row_number() OVER (PARTITION BY community_set_id ORDER BY rank NULLS LAST, id) - 1)::integer AS position
      FROM community
    ) UPDATE community c SET position = ordered.position FROM ordered
      WHERE c.community_set_id = ordered.community_set_id AND c.id = ordered.id;
    CREATE INDEX idx_native_community_position ON community(community_set_id, position, id);
    CREATE INDEX idx_native_graph_edge_notes ON graph_edge_artifact(from_note_id, to_note_id);
    CREATE INDEX idx_native_community_assignment_note ON community_assignment(note_id);
  `,
}
