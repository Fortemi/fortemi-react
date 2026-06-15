import { describe, expect, it } from 'vitest'
import { deriveTypeCounts } from '../hooks/useAiwgIndex'
import type {
  AiwgFortemiChunkManifest,
  AiwgFortemiIndexExport,
} from '@fortemi/core/aiwg-index'

// Covers #173: `counts` must work identically in whole-index and chunked modes.
describe('deriveTypeCounts', () => {
  it('returns {} when neither an index nor a chunked manifest is loaded', () => {
    expect(deriveTypeCounts(null, null)).toEqual({})
  })

  it('tallies per-type counts from a whole-index export', () => {
    const index = {
      items: [{ type: 'note' }, { type: 'note' }, { type: 'task' }],
    } as unknown as AiwgFortemiIndexExport
    expect(deriveTypeCounts(index, null)).toEqual({ note: 2, task: 1 })
  })

  it('derives counts from the chunked manifest `type` facet in chunked mode', () => {
    const manifest = {
      facets: { type: { note: 5, task: 3 }, privacy: { public: 8 } },
    } as unknown as AiwgFortemiChunkManifest
    // index is null in chunked mode; counts still resolve from the manifest facet.
    expect(deriveTypeCounts(null, manifest)).toEqual({ note: 5, task: 3 })
  })

  it('chunked manifest takes precedence and tolerates a manifest with no facets', () => {
    const manifest = {} as unknown as AiwgFortemiChunkManifest
    expect(deriveTypeCounts(null, manifest)).toEqual({})
  })
})
