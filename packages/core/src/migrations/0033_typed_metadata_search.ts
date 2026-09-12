import type { Migration } from '../migration-runner.js'

export const migration0033: Migration = {
  version: 33,
  name: '0033_typed_metadata_search',
  sql: `
    CREATE FUNCTION public.metadata_search_order_key_v1(value jsonb)
    RETURNS numeric LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path = pg_catalog
    AS $function$
        SELECT CASE jsonb_typeof(value)
            WHEN 'number' THEN trunc(greatest(-1e16::numeric,
                least(1e16::numeric, (value #>> '{}')::numeric)), 18)
            WHEN 'boolean' THEN CASE WHEN value = 'true'::jsonb THEN 1::numeric ELSE 0::numeric END
            ELSE NULL::numeric
        END
    $function$;

    CREATE FUNCTION public.metadata_search_text_key_v1(value jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path = pg_catalog
    AS $function$
        SELECT CASE WHEN jsonb_typeof(value) = 'string'
            THEN left(value #>> '{}', 256) ELSE NULL::text END
    $function$;

    DO $metadata_indexes$
    DECLARE metadata_path text;
    BEGIN
      FOREACH metadata_path IN ARRAY ARRAY['provider', 'model', 'role', 'event_kind', 'sensitivity']
      LOOP
        -- Superseded unbounded indexes can reject large values before query rechecks.
        EXECUTE format('DROP INDEX %I', 'idx_note_metadata_' || metadata_path);
        EXECUTE format('DROP INDEX %I', 'idx_note_native_metadata_' || metadata_path);
        EXECUTE format(
          'CREATE INDEX %I ON note (
            (jsonb_typeof(metadata -> %L)),
            (public.metadata_search_order_key_v1(metadata -> %L)),
            (public.metadata_search_text_key_v1(metadata -> %L) COLLATE "C"))',
          'idx_note_metadata_' || metadata_path || '_v1', metadata_path, metadata_path, metadata_path);
      END LOOP;
    END
    $metadata_indexes$;

    CREATE INDEX idx_source_identity_metadata_run_v1 ON source_identity
      (tenant_id, import_run_id COLLATE "C", note_id);
    CREATE INDEX idx_source_identity_metadata_note_v1 ON source_identity (tenant_id, note_id);
    UPDATE metadata_index_path SET value_type = 'json-scalar-v1', indexed_at = now()
      WHERE path IN ('provider', 'model', 'role', 'event_kind', 'sensitivity');
  `,
}
