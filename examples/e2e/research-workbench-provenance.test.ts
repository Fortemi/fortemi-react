import { expect, test, type Page } from '@playwright/test'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error' || /favicon/i.test(message.text())) return
    errors.push(`console: ${message.text()}`)
  })
  return errors
}

test('research workbench renders source and citation PROV metadata', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/research-workbench/')
  await expect(page.getByRole('heading', { name: /Provenance/ })).toBeVisible({ timeout: 60_000 })

  await expect(page.getByText('PROV ingest', { exact: true })).toBeVisible()
  await expect(page.getByText('paper:dpr', { exact: true })).toBeVisible()
  await expect(page.getByText('doi:10.48550/arXiv.2004.04906', { exact: true })).toBeVisible()
  await expect(page.getByText('demo:corpus-curator', { exact: true }).last()).toBeVisible()

  await page.locator('.paper-list').getByRole('button', { name: /Retrieval-Augmented Generation/ }).click()
  await expect(page.getByText('paper:rag', { exact: true })).toBeVisible()
  await expect(page.getByText('paper:dpr', { exact: true })).toBeVisible()
  await expect(page.getByText('paper:colbert', { exact: true })).toBeVisible()
  await expect(page.getByText('PROV derive', { exact: true })).toHaveCount(3)

  expect(errors, `page reported errors:\n${errors.join('\n')}`).toEqual([])
})
