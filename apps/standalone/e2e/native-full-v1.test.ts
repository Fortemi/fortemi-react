import { readFile, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { unpackTarGz, validateFullV1ShardArchive } from '@fortemi/core'

type ProbeResult = {
  importedNotes: number
  detail: { id: string; metadata: unknown }
  createdId: string
  initial: number[]; edited: number[]; scoped: number[]; returned: number[]
}
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}
const records = (files: Map<string, Uint8Array>, path: string) => {
  const text = new TextDecoder().decode(files.get(path))
  return path.endsWith('.jsonl') ? text.split('\n').filter(Boolean).map(JSON.parse) : JSON.parse(text)
}
function equalNativeFiles(actual: Map<string, Uint8Array>, expected: Map<string, Uint8Array>) {
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort())
  for (const [path, bytes] of expected) {
    if (path === 'manifest.json') {
      const a = records(actual, path), e = records(expected, path)
      for (const field of ['format', 'version', 'profile', 'min_reader_version', 'counts', 'migration_history', 'migrated_from']) {
        expect(Object.hasOwn(a, field), field).toBe(Object.hasOwn(e, field))
        expect(a[field], field).toEqual(e[field])
      }
    } else if (path.endsWith('.json') || path.endsWith('.jsonl')) {
      const normalized = (files: Map<string, Uint8Array>) => records(files, path)
        .map((row: unknown) => JSON.stringify(canonical(row))).sort()
      expect(normalized(actual), path).toEqual(normalized(expected))
    } else expect(actual.get(path), path).toEqual(bytes)
  }
}

test('native full-v1 restore survives browser CRUD, scope and clean re-import', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const archive = new Uint8Array(await readFile(new URL(
    '../../../packages/core/src/__tests__/shard/fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url)))
  await page.goto('/e2e/fixtures/native-full-v1.html')
  await expect(page.getByRole('status')).toHaveText('Ready', { timeout: 45_000 })
  const result = await page.evaluate((bytes) => (window as unknown as {
    runNativeFullV1: (bytes: number[]) => Promise<ProbeResult>
  }).runNativeFullV1(bytes), Array.from(archive))
  for (const name of ['initial', 'edited', 'scoped', 'returned'] as const) {
    const bytes = new Uint8Array(result[name])
    expect((await validateFullV1ShardArchive(bytes)).errors, name).toEqual([])
    const path = testInfo.outputPath(`${name}.shard`)
    await writeFile(path, bytes)
    await testInfo.attach(`${name}.shard`, { path, contentType: 'application/gzip' })
  }
  const sourceFiles = unpackTarGz(archive)
  const sourceNotes = records(sourceFiles, 'notes.jsonl')
  expect(result.importedNotes).toBe(sourceNotes.length)
  expect(result.detail).toEqual({ id: sourceNotes[0].id, metadata: sourceNotes[0].metadata })
  equalNativeFiles(unpackTarGz(new Uint8Array(result.initial)), sourceFiles)
  const edited = unpackTarGz(new Uint8Array(result.edited))
  const editedNotes = records(edited, 'notes.jsonl')
  expect(editedNotes).toHaveLength(sourceNotes.length + 1)
  const changed = editedNotes.find((row: { id: string }) => row.id === sourceNotes[0].id)
  expect(changed.revised_content).toBe('BROWSER-NATIVE-EDIT-424')
  expect(changed.deleted_at).toEqual(expect.any(String))
  const scoped = unpackTarGz(new Uint8Array(result.scoped))
  expect(records(scoped, 'notes.jsonl').map((row: { id: string }) => row.id)).toEqual([result.createdId])
  expect([...scoped.keys()].some((path) => path.startsWith('blobs/'))).toBe(false)
  equalNativeFiles(unpackTarGz(new Uint8Array(result.returned)), edited)
  expect(errors).toEqual([])
})
