import { test, expect } from '@playwright/test'

// PGlite WASM initialization takes ~25-30s in headless browsers.
const PGLITE_TIMEOUT = 45000

test('app loads and shows fortemi header', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('fortemi', { timeout: PGLITE_TIMEOUT })
})

test('app displays version', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('text=v2026')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})

test('new note button is visible after load', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '+ New Note' })).toBeVisible({ timeout: PGLITE_TIMEOUT })
})

test('search bar is visible after load', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByPlaceholder('Search notes... (Ctrl+K)')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})

test('graph page exposes vector property filters', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Graph' }).click()

  await expect(page.getByRole('heading', { name: 'Graph' })).toBeVisible({ timeout: PGLITE_TIMEOUT })
  await expect(page.getByLabel('Vector set')).toBeVisible()
  await expect(page.getByLabel('Source')).toBeVisible()
  await expect(page.getByLabel('Visibility')).toBeVisible()
  await expect(page.getByLabel('Enrichment')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build graph' })).toBeVisible()
})
