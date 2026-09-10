import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unpackTarGz, validateCoreV1ShardArchive } from '@fortemi/core'

const [archivePath, baseUrl, outputDir] = process.argv.slice(2)
assert.ok(archivePath && baseUrl && outputDir, 'Usage: node scripts/verify-default-export-server.mjs <product-download.shard> <clean-server-url> <evidence-dir>')
const bytes = await readFile(archivePath)
const digest = (data) => createHash('sha256').update(data).digest('hex')
const validate = async (data) => {
  const result = await validateCoreV1ShardArchive(new Uint8Array(data))
  assert.equal(result.valid, true, result.errors.join('; '))
  return unpackTarGz(new Uint8Array(data))
}
const source = await validate(bytes)
const read = (files, path) => {
  const text = new TextDecoder().decode(files.get(path))
  return path.endsWith('.jsonl') ? text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : JSON.parse(text)
}
const manifest = read(source, 'manifest.json')
assert.equal(manifest.profile, 'core-v1')
assert.equal(manifest.version, '1.2.0')
assert.ok(read(source, 'notes.jsonl').some((note) => note.original_content === 'PRODUCT-EXPORT-CONTENT-423'))
async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl))
  assert.equal(response.ok, true, `${path}: ${response.status}`)
  return response.json()
}
async function upload(data, query, expectedStatus = 200) {
  const body = new FormData()
  body.set('file', new Blob([data]), 'product.shard')
  const response = await fetch(new URL(`/api/v1/backup/knowledge-shard/upload?skip_embedding_regen=true&${query}`, baseUrl), { method: 'POST', body })
  const result = await response.json()
  assert.equal(response.status, expectedStatus, JSON.stringify(result))
  return result
}
const health = await getJson('/health')
assert.equal((await getJson('/api/v1/notes?limit=1')).total, 0, 'Destination must be clean')
const dryRun = await upload(bytes, 'dry_run=true')
assert.equal(dryRun.status, 'success')
assert.equal((await getJson('/api/v1/notes?limit=1')).total, 0, 'Dry run mutated destination')
const invalid = await upload(Buffer.from('not a gzip archive'), '', 400)
assert.equal((await getJson('/api/v1/notes?limit=1')).total, 0, 'Malformed input mutated destination')
const imported = await upload(bytes, 'on_conflict=replace')
assert.equal(imported.status, 'success')
assert.equal(imported.imported.notes, manifest.counts.notes)
const repeated = await upload(bytes, 'on_conflict=skip')
assert.equal(repeated.status, 'success')
assert.equal(repeated.skipped.notes, manifest.counts.notes)
assert.equal((await getJson('/api/v1/notes?limit=1')).total, manifest.counts.notes)
const response = await fetch(new URL('/api/v1/backup/knowledge-shard?profile=core-v1&schema_version=1.2.0', baseUrl))
assert.equal(response.ok, true)
const reexport = Buffer.from(await response.arrayBuffer())
const restored = await validate(reexport)
assert.equal(read(restored, 'manifest.json').profile, 'core-v1')
for (const path of ['notes.jsonl', 'collections.json', 'tags.json', 'templates.json', 'links.jsonl']) {
  const expected = read(source, path)
  const actual = read(restored, path)
  assert.equal(actual.length, expected.length, `${path} count differs`)
  for (const record of expected) {
    const match = actual.find((candidate) => candidate.id === record.id && (record.id !== undefined || candidate.name === record.name))
    assert.ok(match, `Missing record in ${path}`)
    for (const [key, value] of Object.entries(record)) {
      if (key === 'tags') {
        assert.deepEqual([...match[key]].sort(), [...value].sort())
      } else {
        assert.deepEqual(match[key], value, `${path}.${key} differs`)
      }
    }
  }
}
await mkdir(outputDir, { recursive: true })
await writeFile(join(outputDir, 'product-default-core-v1.shard'), bytes)
await writeFile(join(outputDir, 'server-reexport-core-v1.shard'), reexport)
const receipt = {
  checkedAt: new Date().toISOString(), profile: '1.2.0/core-v1',
  server: { version: health.version, source: health.git_sha },
  producerArchive: { sha256: digest(bytes), bytes: bytes.length, counts: manifest.counts },
  reexportArchive: { sha256: digest(reexport), bytes: reexport.length },
  checks: { cleanDestination: true, dryRunZeroMutation: true, malformedZeroMutation: true, repeatedSkip: true, profileValidation: true, sourceFieldsPreserved: true },
  dryRun, invalid, imported, repeated,
  boundary: 'Product download to the inspected Linux server; not released React package qualification, full-v1 native restore, or suite-wide portability. Server health identity alone does not establish a released artifact.',
}
await writeFile(join(outputDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ server: receipt.server, checks: receipt.checks, source: receipt.producerArchive.sha256, reexport: receipt.reexportArchive.sha256 }, null, 2))
