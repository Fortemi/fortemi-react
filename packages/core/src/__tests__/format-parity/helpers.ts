import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FIXTURES_DIR = join(__dirname, 'fixtures')

/**
 * Load a server-extracted JSON fixture for a given table.
 */
export function loadServerFixture(tableName: string): Record<string, unknown>[] {
  const filePath = join(FIXTURES_DIR, `${tableName}.json`)
  const content = readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * Get the canonical type name for a value.
 * PGlite returns TIMESTAMPTZ columns as Date objects; the server returns ISO strings.
 * Both map to 'string' so shape comparison works across the boundary.
 */
function getValueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'string'
  return typeof value
}

/**
 * Get the "shape" of a row: field names and their JS types, sorted by name.
 */
export function getRowShape(row: Record<string, unknown>): Record<string, string> {
  const shape: Record<string, string> = {}
  for (const [key, value] of Object.entries(row)) {
    shape[key] = getValueType(value)
  }
  return shape
}

/**
 * Compare field names and types between actual (browser) and expected (server) rows.
 * Returns { pass: true } or { pass: false, missing, extra, typeMismatch }.
 */
export function matchServerShape(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): {
  pass: boolean
  missing: string[]
  extra: string[]
  typeMismatch: Array<{ field: string; expected: string; actual: string }>
} {
  const expectedKeys = new Set(Object.keys(expected))
  const actualKeys = new Set(Object.keys(actual))

  const missing = [...expectedKeys].filter(k => !actualKeys.has(k))
  const extra = [...actualKeys].filter(k => !expectedKeys.has(k))

  const typeMismatch: Array<{ field: string; expected: string; actual: string }> = []
  for (const key of expectedKeys) {
    if (actualKeys.has(key)) {
      const expectedType = getValueType(expected[key])
      const actualType = getValueType(actual[key])
      // Allow null in either direction (nullable columns)
      if (expectedType !== actualType && expectedType !== 'null' && actualType !== 'null') {
        typeMismatch.push({ field: key, expected: expectedType, actual: actualType })
      }
    }
  }

  return {
    pass: missing.length === 0 && extra.length === 0 && typeMismatch.length === 0,
    missing,
    extra,
    typeMismatch,
  }
}
