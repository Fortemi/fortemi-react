import { test, expect } from '@playwright/test'

test.describe('WebKitGTK compatibility diagnostics', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'WebKitGTK risk checks only run in the WebKit project')

  test('initializes PGlite with pgvector on IndexedDB and handles missing WebGPU', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: '+ New Note' })).toBeVisible({ timeout: 45000 })

    await page.waitForFunction(() => Boolean(window.__FORTEMI_E2E__), null, { timeout: 5000 })

    const diagnostics = await page.evaluate(async () => {
      const e2e = window.__FORTEMI_E2E__
      if (!e2e) throw new Error('Fortemi E2E diagnostics are unavailable')

      const vectorResult = await e2e.query(
        "SELECT ('[1,0,0]'::vector <=> '[0,1,0]'::vector) AS distance",
      ) as { rows: Array<{ distance: number | string }> }
      const schemaResult = await e2e.query(
        "SELECT to_regclass('public.note') AS note_table, to_regclass('public.embedding') AS embedding_table",
      ) as { rows: Array<{ note_table: string | null; embedding_table: string | null }> }
      const gpu = await e2e.detectGpuCapabilities()

      return {
        persistence: e2e.persistence,
        hasIndexedDB: typeof indexedDB !== 'undefined',
        hasOpfsApi: typeof navigator.storage?.getDirectory === 'function',
        vectorDistance: Number(vectorResult.rows[0]?.distance),
        noteTable: schemaResult.rows[0]?.note_table,
        embeddingTable: schemaResult.rows[0]?.embedding_table,
        gpu,
      }
    })

    expect(diagnostics.persistence).toBe('idb')
    expect(diagnostics.hasIndexedDB).toBe(true)
    expect(typeof diagnostics.hasOpfsApi).toBe('boolean')
    expect(Number.isFinite(diagnostics.vectorDistance)).toBe(true)
    expect(diagnostics.vectorDistance).toBeGreaterThanOrEqual(0)
    expect(diagnostics.noteTable).toBe('note')
    expect(diagnostics.embeddingTable).toBe('embedding')
    expect(typeof diagnostics.gpu.webgpuAvailable).toBe('boolean')
    if (!diagnostics.gpu.webgpuAvailable) {
      expect(['none', 'unavailable', 'error']).toContain(diagnostics.gpu.vendor)
    }
  })
})
