import { describe, expect, it } from 'vitest'
import corpus from '../../schemas/metadata-search/candidate/1.0.0/evidence-vectors.json' with { type: 'json' }
import { bindSearchEvidence, parseSearchEvidenceLocator, resolveSearchEvidence, MAX_EVIDENCE_BYTES } from '../search-evidence.js'
import type { EvidenceTextSnapshot } from '../search-evidence.js'

describe('authority-owned candidate evidence corpus', () => {
  for (const vector of corpus.cases) {
    it(vector.id, () => {
      const snapshot = vector.snapshot as EvidenceTextSnapshot | null
      if ('error' in vector) expect(() => resolveSearchEvidence(vector.locator, snapshot)).toThrow(vector.error)
      else {
        expect(resolveSearchEvidence(vector.locator, snapshot)).toBe(vector.text)
        expect(bindSearchEvidence(snapshot!, vector.locator.span.start, vector.locator.span.end)).toEqual(vector.locator)
      }
    })
  }
})

describe('exact immutable evidence binding', () => {
  const text: EvidenceTextSnapshot = {note_id:'note-1',unit:{kind:'embedding',id:'unit-7',index:7},content:'a\u{1f680}e\u0301'}
  it('binds and serializes the exact UTF-8 range', () => {
    const locator = bindSearchEvidence(text,1,5)
    expect(resolveSearchEvidence(JSON.parse(JSON.stringify(locator)),text)).toBe('\u{1f680}')
    expect(locator.unit.index).toBe(7)
  })
  it('takes immutable copies, not mutable caller references', () => {
    const mutable = JSON.parse(JSON.stringify(bindSearchEvidence(text,1,5)))
    const parsed = parseSearchEvidenceLocator(mutable)
    mutable.unit.id='other';mutable.span.end=8
    expect(resolveSearchEvidence(parsed,text)).toBe('\u{1f680}')
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.unit)).toBe(true)
    expect(Object.isFrozen(parsed.span)).toBe(true)
  })
  it('rejects non-JSON numeric values and lone surrogates without echoing input', () => {
    const locator=bindSearchEvidence(text,1,5)
    for(const index of [NaN,Infinity,undefined]) expect(()=>parseSearchEvidenceLocator({...locator,unit:{...locator.unit,index}})).toThrow('SEARCH_EVIDENCE_INVALID')
    for(const id of ['\ud800','\udc00','a\ud800b']) expect(()=>parseSearchEvidenceLocator({...locator,note_id:id})).toThrow('SEARCH_EVIDENCE_INVALID')
    expect(()=>bindSearchEvidence({...text,content:'\ud800'},0,1)).toThrow('SEARCH_EVIDENCE_INVALID')
  })
  it('rejects builder ranges that split code points including empty ranges', () => {
    for(const [start,end] of [[2,5],[1,4],[2,2],[5,1],[-1,1],[0,99],[0,1.5]]) expect(()=>bindSearchEvidence(text,start,end)).toThrow('SEARCH_EVIDENCE_INVALID')
  })
  it('bounds complete text bytes independently of requested span size', () => {
    const oversized={...text,content:'\u{1f680}'.repeat(MAX_EVIDENCE_BYTES/4+1)}
    expect(()=>bindSearchEvidence(oversized,0,0)).toThrow('SEARCH_EVIDENCE_INVALID')
    expect(()=>resolveSearchEvidence(bindSearchEvidence(text,1,5),oversized)).toThrow('SEARCH_EVIDENCE_UNAVAILABLE')
  })
})
