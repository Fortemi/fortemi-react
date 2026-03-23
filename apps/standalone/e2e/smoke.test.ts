import { test, expect } from '@playwright/test'

// PGlite WASM initialization takes ~25-30s in headless browsers.
const PGLITE_TIMEOUT = 45000

test('app loads and displays title', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('fortemi-browser', { timeout: PGLITE_TIMEOUT })
})

test('app displays version', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('text=v2026')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})
