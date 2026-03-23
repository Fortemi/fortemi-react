import { test, expect } from '@playwright/test'

// PGlite WASM initialization takes ~25-30s in headless browsers.
// These tests wait for the ready state after that initialization completes.
const PGLITE_TIMEOUT = 45000

test('shows loading screen then transitions to ready state', async ({ page }) => {
  await page.goto('/')

  // Verify the loading screen appears immediately (within 1 second)
  await expect(page.locator('h1')).toContainText('fortemi', { timeout: 1000 })

  // After PGlite initializes, the ready state should render
  await expect(page.locator('text=Database ready')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})

test('displays archive name when ready', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('text=archive: default')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})

test('app displays fortemi-browser title when ready', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('fortemi-browser', { timeout: PGLITE_TIMEOUT })
})

test('app displays version after initialization completes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('text=v2026')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})
