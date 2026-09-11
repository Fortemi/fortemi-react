import type { Migration } from '../migration-runner.js'
import { nativeIdentities } from '../shard/native-identities.js'

const triggers = Object.entries(nativeIdentities).flatMap(([component, spec]) =>
  (component === 'links' ? ['link', 'link_url_target'] : [spec.table]).map((table) => `
    CREATE TRIGGER native_lineage_delete AFTER DELETE ON ${table} FOR EACH ROW
      EXECUTE FUNCTION delete_native_record_lineage('${component}', ${spec.keys.map((key) => `'${key}'`).join(', ')});`)).join('\n')

export const migration0031: Migration = {
  version: 31,
  name: '0031_native_shard_lineage',
  sql: `
    CREATE TABLE native_shard_lineage (
      id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
      migration_history JSONB CHECK (jsonb_typeof(migration_history) = 'array'),
      migrated_from TEXT
    );
    CREATE TABLE native_shard_record_lineage (
      component TEXT NOT NULL CHECK (component IN (${Object.keys(nativeIdentities).map((component) => `'${component}'`).join(', ')})),
      record_key JSONB NOT NULL CHECK (jsonb_typeof(record_key) = 'array'),
      lineage_id TEXT NOT NULL REFERENCES native_shard_lineage(id),
      PRIMARY KEY (component, record_key)
    );
    CREATE TABLE native_shard_empty_lineage (
      singleton BOOLEAN PRIMARY KEY CHECK (singleton),
      lineage_id TEXT NOT NULL REFERENCES native_shard_lineage(id)
    );
    CREATE FUNCTION delete_native_record_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE record_identity JSONB := '[]'::jsonb; field_index INTEGER;
      BEGIN
        FOR field_index IN 1..TG_NARGS-1 LOOP
          record_identity := record_identity || jsonb_build_array(to_jsonb(OLD)->TG_ARGV[field_index]);
        END LOOP;
        DELETE FROM native_shard_record_lineage WHERE component = TG_ARGV[0] AND record_key = record_identity;
        RETURN OLD;
      END;
    $$;
    ${triggers}
  `,
}
