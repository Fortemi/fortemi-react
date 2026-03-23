import { test, expect } from '@playwright/test'

// PGlite WASM initialization takes ~25-30s in headless browsers.
// These tests wait for the ready state after that initialization completes.
const PGLITE_TIMEOUT = 45000

test('shows fortemi title during and after load', async ({ page }) => {
  await page.goto('/')

  // The header h1 "fortemi" should appear (either loading screen or ready state)
  // Allow extra time for Vite dev server initial module load and React hydration
  await expect(page.locator('h1')).toContainText('fortemi', { timeout: 10000 })
})

test('transitions to note list UI after initialization', async ({ page }) => {
  await page.goto('/')

  // After PGlite initializes, the note list empty state or the New Note button should appear
  await expect(page.getByRole('button', { name: '+ New Note' })).toBeVisible({ timeout: PGLITE_TIMEOUT })
})

test('app displays version after initialization completes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('text=v2026')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})

test('empty note list prompt is visible after initialization', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('text=No notes yet')).toBeVisible({ timeout: PGLITE_TIMEOUT })
})
