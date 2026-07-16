// Featured knowledge-workspace demo — semantic upgrade smoke test (#345).
//
// Walks the exact runtime path a visitor takes in the deployed gallery:
//   1. Open the featured knowledge workspace (no-database shard reader).
//   2. Confirm text search works over the bundled corpus.
//   3. Click "Enable semantic search" (upgrades to PGlite, imports
//      corpus.notes.shard, then corpus.summaries.shard, loads the MiniLM
//      query model, registers the semantic capability).
//   4. Run a semantic query and assert hybrid results render.
//
// Fails on shard-import rollback (surfaced as the "Semantic search
// unavailable" banner), on any page/console error, or on missing results.
// Typecheck and build cannot see any of this — the regression in #344
// shipped through both.

import { test, expect, type Page } from '@playwright/test'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Benign asset noise (e.g. a missing favicon) is not a workspace failure.
    if (/favicon/i.test(text)) return
    errors.push(`console: ${text}`)
  })
  return errors
}

test('semantic upgrade succeeds against the bundled corpus shards', async ({ page }) => {
  const errors = collectErrors(page)

  // 1. Open the featured demo from the built gallery.
  await page.goto('/knowledge-workspace/')

  // The no-DB reader opens on the Search tab once the notes shard is parsed.
  const readerSearch = page.getByPlaceholder('search the corpus…')
  await expect(readerSearch).toBeVisible({ timeout: 60_000 })

  // 2. Text search works before any upgrade.
  await readerSearch.fill('agent')
  await expect(page.getByText(/text mode · \d+ documents?/)).toBeVisible({ timeout: 30_000 })

  // 3. Upgrade: swaps in the PGlite workspace with autoSemantic. This imports
  //    corpus.notes.shard, then corpus.summaries.shard (#344's failure point),
  //    builds the HNSW index, and loads the query-embedding model.
  await page.getByRole('button', { name: 'Enable semantic search' }).first().click()

  const failureBanner = page.getByText('Semantic search unavailable')
  const semanticReady = page.getByRole('button', { name: 'AI summaries' })
  await expect(semanticReady.or(failureBanner).first()).toBeVisible({ timeout: 360_000 })
  await expect(failureBanner, 'semantic upgrade reported a failure banner').toHaveCount(0)
  await expect(semanticReady).toBeVisible()

  // 4. A semantic query returns ranked hybrid results.
  const workspaceSearch = page.getByPlaceholder('search the corpus…')
  await workspaceSearch.fill('language model reliability')
  await expect(page.getByText(/hybrid mode · \d+ documents?/)).toBeVisible({ timeout: 60_000 })

  expect(errors, `page reported errors:\n${errors.join('\n')}`).toEqual([])
})
