import { describe, expect, it } from 'vitest'
import vectors from '../../schemas/metadata-search/candidate/1.0.0/evidence-set-vectors.json' with { type: 'json' }
import { createSearchEvidenceSet, mergeSearchEvidenceSets, parseSearchEvidenceSet, type SearchEvidenceOmission } from '../search-evidence-set.js'

interface Case {
  id: string
  operation: string
  note_id: string
  input: unknown
  omissions?: SearchEvidenceOmission[]
  expected?: unknown
  error?: string
}
describe('authority-owned candidate evidence envelope corpus', () => {
  it.each((vectors as unknown as { cases: Case[] }).cases)('$id', test => {
    const execute = () => {
      if (test.operation === 'parse') return parseSearchEvidenceSet(test.input, test.note_id)
      if (test.operation === 'build') return createSearchEvidenceSet(test.note_id, test.input as unknown[], test.omissions)
      if (test.operation === 'merge') return mergeSearchEvidenceSets(test.note_id, (test.input as unknown[]).map(set => parseSearchEvidenceSet(set, test.note_id)))
      throw new Error('Unknown corpus operation')
    }
    if (test.error) expect(execute).toThrow(test.error)
    else expect(execute()).toEqual(test.expected)
  })
  it('takes immutable copies of the envelope and every locator', () => {
    const input = structuredClone(vectors.cases[0].input)
    const result = parseSearchEvidenceSet(input, 'note-1')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.locators)).toBe(true)
    expect(Object.isFrozen(result.locators[0].unit)).toBe(true)
    expect(Object.isFrozen(result.omissions)).toBe(true)
    expect(result.locators[0]).not.toBe((input as { locators: unknown[] }).locators[0])
  })
})
