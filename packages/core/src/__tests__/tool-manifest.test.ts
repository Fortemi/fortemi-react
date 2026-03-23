/**
 * FortemiToolManifest — unit tests.
 *
 * Tests the manifest registry, filtering, search, and PlinyCapability projection.
 * No database required — all logic is pure.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FortemiToolManifest, fortemiManifest } from '../tools/manifest.js'

// ---------------------------------------------------------------------------
// FortemiToolManifest — registry
// ---------------------------------------------------------------------------

describe('FortemiToolManifest', () => {
  let manifest: FortemiToolManifest

  beforeEach(() => {
    manifest = new FortemiToolManifest()
  })

  // -------------------------------------------------------------------------
  // Coverage: registry size
  // -------------------------------------------------------------------------

  it('has at least 10 tools defined', () => {
    expect(manifest.list().length).toBeGreaterThanOrEqual(10)
  })

  // -------------------------------------------------------------------------
  // Coverage: get()
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('returns a tool definition by exact id', () => {
      const tool = manifest.get('mnemos.capture_knowledge')
      expect(tool).toBeDefined()
      expect(tool?.id).toBe('mnemos.capture_knowledge')
    })

    it('returns undefined for an unknown id', () => {
      const tool = manifest.get('mnemos.does_not_exist')
      expect(tool).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: list()
  // -------------------------------------------------------------------------

  describe('list()', () => {
    it('returns all defined tools as an array', () => {
      const tools = manifest.list()
      expect(Array.isArray(tools)).toBe(true)
      expect(tools.length).toBeGreaterThanOrEqual(10)
    })

    it('returns a new array on each call (not a mutable reference)', () => {
      const a = manifest.list()
      const b = manifest.list()
      expect(a).not.toBe(b)
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: byCategory()
  // -------------------------------------------------------------------------

  describe('byCategory()', () => {
    it('returns only capture tools for category "capture"', () => {
      const tools = manifest.byCategory('capture')
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.every(t => t.category === 'capture')).toBe(true)
    })

    it('returns only search tools for category "search"', () => {
      const tools = manifest.byCategory('search')
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.every(t => t.category === 'search')).toBe(true)
    })

    it('returns only manage tools for category "manage"', () => {
      const tools = manifest.byCategory('manage')
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.every(t => t.category === 'manage')).toBe(true)
    })

    it('returns only organize tools for category "organize"', () => {
      const tools = manifest.byCategory('organize')
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.every(t => t.category === 'organize')).toBe(true)
    })

    it('returns empty array for unknown category', () => {
      const tools = manifest.byCategory('nonexistent')
      expect(tools).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: search()
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('returns tools whose name, description, or tags include the query', () => {
      const results = manifest.search('note')
      expect(results.length).toBeGreaterThan(0)
    })

    it('is case-insensitive', () => {
      const lower = manifest.search('capture')
      const upper = manifest.search('CAPTURE')
      expect(lower.map(t => t.id).sort()).toEqual(upper.map(t => t.id).sort())
    })

    it('matches against tags', () => {
      const results = manifest.search('search')
      expect(results.some(t => t.id === 'mnemos.search')).toBe(true)
    })

    it('returns empty array when no tools match', () => {
      const results = manifest.search('zzznomatchzzz')
      expect(results).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: toPlinyCapabilities()
  // -------------------------------------------------------------------------

  describe('toPlinyCapabilities()', () => {
    it('returns an array with at least one entry per tool', () => {
      const caps = manifest.toPlinyCapabilities()
      expect(caps.length).toBe(manifest.list().length)
    })

    it('each capability has the required PlinyCapability fields', () => {
      const caps = manifest.toPlinyCapabilities()
      for (const cap of caps) {
        expect(typeof cap.id).toBe('string')
        expect(typeof cap.name).toBe('string')
        expect(typeof cap.description).toBe('string')
        expect(typeof cap.inputSchema).toBe('object')
        expect(Array.isArray(cap.tags)).toBe(true)
        expect(typeof cap.sideEffects).toBe('boolean')
      }
    })

    it('each capability inputSchema is a valid JSON Schema object with a "type" field', () => {
      const caps = manifest.toPlinyCapabilities()
      for (const cap of caps) {
        expect(cap.inputSchema).toHaveProperty('type')
        expect(typeof cap.inputSchema['type']).toBe('string')
      }
    })

    it('capability id matches the source tool id', () => {
      const tools = manifest.list()
      const caps = manifest.toPlinyCapabilities()
      const capIds = caps.map(c => c.id).sort()
      const toolIds = tools.map(t => t.id).sort()
      expect(capIds).toEqual(toolIds)
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: data quality invariants
  // -------------------------------------------------------------------------

  describe('tool data quality', () => {
    it('all tools have a non-empty description', () => {
      const tools = manifest.list()
      for (const tool of tools) {
        expect(tool.description.trim().length).toBeGreaterThan(0)
      }
    })

    it('all tools have at least one tag', () => {
      const tools = manifest.list()
      for (const tool of tools) {
        expect(tool.tags.length).toBeGreaterThan(0)
      }
    })

    it('all tool ids follow the "mnemos.<name>" prefix convention', () => {
      const tools = manifest.list()
      for (const tool of tools) {
        expect(tool.id).toMatch(/^mnemos\./)
      }
    })

    it('all tool ids are unique', () => {
      const ids = manifest.list().map(t => t.id)
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length)
    })

    it('all tools have a valid category', () => {
      const validCategories = new Set([
        'capture', 'search', 'manage', 'organize', 'process', 'analyze', 'system',
      ])
      const tools = manifest.list()
      for (const tool of tools) {
        expect(validCategories.has(tool.category)).toBe(true)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: getCategoryCounts()
  // -------------------------------------------------------------------------

  describe('getCategoryCounts()', () => {
    it('returns counts that sum to total tool count', () => {
      const counts = manifest.getCategoryCounts()
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
      expect(total).toBe(manifest.list().length)
    })

    it('capture category has count >= 1', () => {
      const counts = manifest.getCategoryCounts()
      expect(counts['capture']).toBeGreaterThanOrEqual(1)
    })

    it('search category has count >= 1', () => {
      const counts = manifest.getCategoryCounts()
      expect(counts['search']).toBeGreaterThanOrEqual(1)
    })

    it('returns an object with numeric values only', () => {
      const counts = manifest.getCategoryCounts()
      for (const value of Object.values(counts)) {
        expect(typeof value).toBe('number')
        expect(value).toBeGreaterThan(0)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: singleton export
  // -------------------------------------------------------------------------

  describe('fortemiManifest singleton', () => {
    it('is an instance of FortemiToolManifest', () => {
      expect(fortemiManifest).toBeInstanceOf(FortemiToolManifest)
    })

    it('has at least 10 tools', () => {
      expect(fortemiManifest.list().length).toBeGreaterThanOrEqual(10)
    })
  })

  // -------------------------------------------------------------------------
  // Coverage: filter()
  // -------------------------------------------------------------------------

  describe('filter()', () => {
    it('applies a custom predicate', () => {
      const sideEffectTools = manifest.filter(t => t.sideEffects === true)
      expect(sideEffectTools.every(t => t.sideEffects)).toBe(true)
    })

    it('returns empty array when no tools match predicate', () => {
      const result = manifest.filter(() => false)
      expect(result).toEqual([])
    })

    it('returns all tools when predicate always returns true', () => {
      const result = manifest.filter(() => true)
      expect(result.length).toBe(manifest.list().length)
    })
  })
})
