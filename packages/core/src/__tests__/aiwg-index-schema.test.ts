import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getAiwgFortemiIndexExportSchema } from '../aiwg-index-schema.js'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const schemaPath = resolve(testDir, '../../schemas/aiwg-fortemi-index-export.schema.json')
const receiptPath = resolve(testDir, '../../schemas/aiwg-fortemi-index-export.schema.receipt.json')

describe('#293 vendored AIWG index schema provenance', () => {
  it('matches the pinned upstream receipt', () => {
    const bytes = readFileSync(schemaPath)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      source_repository: string
      source_path: string
      source_commit: string
      sha256: string
    }

    expect(receipt.source_repository).toBe('https://git.integrolabs.net/roctinam/aiwg')
    expect(receipt.source_path).toBe('schemas/aiwg-fortemi-index-export.json')
    expect(receipt.source_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(receipt.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(getAiwgFortemiIndexExportSchema()).toMatchObject({
      $id: 'https://aiwg.io/schemas/aiwg-fortemi-index-export.json',
    })
  })
})
