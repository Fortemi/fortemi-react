import type { QueryExecutor } from '../storage-backend.js'

export type NativeField = { column?: string; kind?: 'json' | 'timestamp' | 'uuid' | 'vector' }
export type NativeFields<T> = { [K in keyof T]-?: NativeField }
export const nativeUuid = (value: string | null): string | null => value === null ? null : value.toLowerCase()
export const nativeUtc = (column: string): string => `CASE WHEN ${column}_utc::timestamptz IS NOT DISTINCT FROM ${column}
  THEN ${column}_utc ELSE to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END`

// SQL identifiers come only from fixed internal maps. Precision companions are
// authoritative only while they agree with the current native query projection.
export async function upsertNativeFields<T extends object>(
  tx: QueryExecutor, table: string, row: T, fields: Partial<NativeFields<T>>, keys: string[],
  extra: Record<string, unknown> = {}, insertOnly: string[] = [],
): Promise<void> {
  const columns: string[] = []
  const values: string[] = []
  const params: unknown[] = []
  for (const [name, field] of Object.entries(fields) as [keyof T & string, NativeField][]) {
    const column = field.column ?? name
    const value = row[name]
    columns.push(column)
    params.push(field.kind === 'json' ? JSON.stringify(value)
      : field.kind === 'vector' ? value === null ? null : JSON.stringify(value)
        : field.kind === 'uuid' ? nativeUuid(value as string | null) : value)
    const param = `$${params.length}`
    values.push(field.kind === 'json' ? `${param}::jsonb`
      : field.kind === 'timestamp' ? `${param}::text::timestamptz`
        : field.kind === 'vector' ? `${param}::vector` : param)
    if (field.kind === 'timestamp') {
      columns.push(`${column}_utc`)
      values.push(`${param}::text`)
    } else if (field.kind === 'vector') {
      columns.push(`${column}_values`)
      params.push(value)
      values.push(`$${params.length}`)
    }
  }
  for (const [column, value] of Object.entries(extra)) {
    columns.push(column); params.push(value); values.push(`$${params.length}`)
  }
  await tx.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})
    ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${columns.filter((column) => !keys.includes(column) && !insertOnly.includes(column))
      .map((column) => `${column} = EXCLUDED.${column}`).join(', ')}`, params)
}

export function selectNativeFields<T>(fields: NativeFields<T>): string {
  return (Object.entries(fields) as [string, NativeField][]).map(([name, field]) => {
    const column = field.column ?? name
    const value = field.kind === 'timestamp' ? nativeUtc(column) : field.kind === 'vector'
      ? `CASE WHEN ${column}_values::vector = ${column} THEN to_jsonb(${column}_values) ELSE ${column}::text::jsonb END`
      : column
    return `${value} AS ${name}`
  }).join(', ')
}
