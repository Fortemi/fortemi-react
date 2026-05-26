/**
 * Migration 0008: Persisted graph and community shard artifacts.
 */

import type { Migration } from '../migration-runner.js'

export const migration0008: Migration = {
  version: 8,
  name: '0008_graph_community_artifacts',
  sql: `
    CREATE TABLE IF NOT EXISTS graph_source (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_table TEXT,
      embedding_set_id TEXT,
      virtual_set_id TEXT,
      model TEXT,
      dimension INTEGER,
      truncate_dimension INTEGER,
      metric TEXT,
      algorithm TEXT,
      parameters_json JSONB,
      input_hash TEXT NOT NULL,
      freshness_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS graph_edge_artifact (
      graph_source_id TEXT NOT NULL REFERENCES graph_source(id) ON DELETE CASCADE,
      from_note_id TEXT NOT NULL REFERENCES note(id),
      to_note_id TEXT NOT NULL REFERENCES note(id),
      weight DOUBLE PRECISION NOT NULL,
      kind TEXT NOT NULL,
      rank INTEGER,
      metadata_json JSONB,
      PRIMARY KEY (graph_source_id, from_note_id, to_note_id, kind)
    );

    CREATE TABLE IF NOT EXISTS community_set (
      id TEXT PRIMARY KEY,
      graph_source_id TEXT NOT NULL REFERENCES graph_source(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      algorithm TEXT,
      parameters_json JSONB,
      input_hash TEXT NOT NULL,
      freshness_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS community (
      id TEXT NOT NULL,
      community_set_id TEXT NOT NULL REFERENCES community_set(id) ON DELETE CASCADE,
      label TEXT,
      rank INTEGER,
      size INTEGER,
      confidence DOUBLE PRECISION,
      representative_note_ids TEXT[],
      metadata_json JSONB,
      PRIMARY KEY (community_set_id, id)
    );

    CREATE TABLE IF NOT EXISTS community_assignment (
      community_set_id TEXT NOT NULL REFERENCES community_set(id) ON DELETE CASCADE,
      community_id TEXT NOT NULL,
      note_id TEXT NOT NULL REFERENCES note(id),
      confidence DOUBLE PRECISION,
      source_type TEXT NOT NULL,
      metadata_json JSONB,
      PRIMARY KEY (community_set_id, note_id),
      FOREIGN KEY (community_set_id, community_id) REFERENCES community(community_set_id, id) ON DELETE CASCADE
    );
  `,
}
