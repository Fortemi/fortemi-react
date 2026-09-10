import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { unpackTarGz, validateCoreV1ShardArchive } from '@fortemi/core'

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`default product export declares core-v1 at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.getByRole('button', { name: '+ New Note' }).click({ timeout: 45_000 })
    await page.getByPlaceholder('Title (optional)').fill('Default export regression')
    await page.getByPlaceholder('Note content (markdown)').fill('PRODUCT-EXPORT-CONTENT-423')
    await page.getByPlaceholder('Tags (comma-separated)').fill('export-423')
    await page.getByRole('button', { name: 'Create Note', exact: true }).click()
    await expect(page.getByPlaceholder('Note content (markdown)')).toBeHidden()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByText('Profile: 1.2.0/core-v1.', { exact: false })).toBeVisible()
    await expect(page.getByText('Attachments: references only;', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Include embeddings')).toHaveCount(0)

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export Shard', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^fortemi-core-v1-.*\.shard$/)
    const archivePath = testInfo.outputPath('default-core-v1.shard')
    await download.saveAs(archivePath)
    const archive = new Uint8Array(await readFile(archivePath))
    const validation = await validateCoreV1ShardArchive(archive)
    expect(validation.errors).toEqual([])
    expect(validation.valid).toBe(true)
    const files = unpackTarGz(archive)
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    expect(manifest).toMatchObject({ version: '1.2.0', profile: 'core-v1' })
    expect(manifest.components).toEqual(['notes', 'collections', 'tags', 'templates', 'links'])
    expect(new TextDecoder().decode(files.get('notes.jsonl'))).toContain('PRODUCT-EXPORT-CONTENT-423')
    expect([...files.keys()].some((path) => path.startsWith('blobs/'))).toBe(false)
    await expect(page.getByText('core-v1 export complete. Attachment bytes excluded.')).toBeVisible()
    await page.getByRole('heading', { name: 'Export Knowledge Shard' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('export-dialog.png') })
    await testInfo.attach('default-core-v1', { path: archivePath, contentType: 'application/gzip' })
  })
}

test('hook exposes losses and rejects unsupported requests without downloading', async ({ page }) => {
  await page.goto('/e2e/fixtures/export-hook.html')
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export with omission' }).click({ timeout: 45_000 })
  await download
  await expect(page.getByLabel('Export report')).toContainText('component-outside-profile')
  await expect(page.getByLabel('Export report')).toContainText('embedding_sets')
  expect(downloads).toHaveLength(1)

  await page.getByRole('button', { name: 'Request embeddings' }).click()
  await expect(page.getByLabel('Export error')).toContainText('core-v1 does not support embedding')
  await expect(page.getByLabel('Export report')).toBeEmpty()
  await page.getByRole('button', { name: 'Request bytes' }).click()
  await expect(page.getByLabel('Export error')).toContainText('not blob sidecar files')
  await page.getByRole('button', { name: 'Request unknown profile' }).click()
  await expect(page.getByLabel('Export error')).not.toBeEmpty()
  await expect(page.getByLabel('Export report')).toContainText('unknown-profile')
  expect(downloads).toHaveLength(1)
})
