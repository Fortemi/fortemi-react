import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { aiwgFortemiIndexToKnowledgeShardWithReport } from '../dist/aiwg-index-shard.js'

const sourcePath = new URL('../src/__tests__/shard/fixtures/aiwg-full-v1/aiwg-index-v2.json', import.meta.url)
const archivePath = new URL('../src/__tests__/shard/fixtures/aiwg-full-v1/aiwg-full-v1.shard', import.meta.url)
const receiptPath = new URL('../src/__tests__/shard/fixtures/aiwg-full-v1/aiwg-full-v1.shard.receipt.json', import.meta.url)
const implementationPath = new URL('../src/aiwg-index-full-shard.ts', import.meta.url)

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sourceBytes = await readFile(sourcePath)
const implementationBytes = await readFile(implementationPath)
const index = JSON.parse(sourceBytes.toString('utf8'))
const result = await aiwgFortemiIndexToKnowledgeShardWithReport(index, {
  createdAt: '2026-07-22T12:00:00.000Z',
  matricVersion: '2026.7.13-candidate',
})
if (!result.success || !result.archive) {
  throw new Error(`AIWG fixture is not full-v1 lossless: ${JSON.stringify(result.losses)}`)
}
await writeFile(archivePath, result.archive)
await writeFile(receiptPath, `${JSON.stringify({
  schemaVersion: 1,
  package: { name: '@fortemi/core', version: '2026.7.13-candidate' },
  source: {
    path: 'src/__tests__/shard/fixtures/aiwg-full-v1/aiwg-index-v2.json',
    sha256: digest(sourceBytes),
  },
  implementation: {
    path: 'src/aiwg-index-full-shard.ts',
    sha256: digest(implementationBytes),
  },
  archive: {
    path: 'src/__tests__/shard/fixtures/aiwg-full-v1/aiwg-full-v1.shard',
    bytes: result.archive.byteLength,
    sha256: digest(result.archive),
  },
  conversion: result.receipt,
  lossless: result.lossless,
  losses: result.losses,
}, null, 2)}\n`)
