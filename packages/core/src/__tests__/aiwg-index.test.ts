import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AIWG_SCAN_REQUIRED_FIELDS,
  aiwgDetailHrefForId,
  aiwgFortemiIndexToCommunityGraph,
  buildAiwgChunkedIndex,
  createAiwgFetchDetailLoader,
  createAiwgIndexController,
  createAiwgReviewDecisionExport,
  encodeAiwgDetailId,
  queryAiwgFortemiIndex,
  validateAiwgFortemiChunkManifest,
  validateAiwgFortemiChunkPart,
  validateAiwgFortemiIndexExport,
  type AiwgChunkedIndexDetailLoader,
  type AiwgChunkedIndexLoader,
  type AiwgFortemiChunkManifest,
  type AiwgFortemiChunkPart,
  type AiwgFortemiIndexExport,
} from '../aiwg-index.js'
import fixture from '../../test/fixtures/sanitized-aiwg-fortemi-index.json' with { type: 'json' }

const index = fixture as unknown as AiwgFortemiIndexExport

function createChunkedFixture(partSize = 2): {
  manifest: AiwgFortemiChunkManifest
  parts: Map<string, AiwgFortemiChunkPart>
} {
  const parts = new Map<string, AiwgFortemiChunkPart>()
  const refs = []
  for (let offset = 0; offset < index.items.length; offset += partSize) {
    const items = index.items.slice(offset, offset + partSize)
    const href = `part-${String(offset).padStart(4, '0')}.json`
    refs.push({ href, offset, count: items.length })
    parts.set(href, {
      schema_version: 'aiwg.fortemi.index.chunk.v1',
      manifest_schema_version: 'aiwg.fortemi.index.chunk-manifest.v1',
      offset,
      items,
    })
  }
  return {
    manifest: {
      schema_version: 'aiwg.fortemi.index.chunk-manifest.v1',
      generated_at: index.generated_at,
      source: index.source,
      total: index.items.length,
      part_size: partSize,
      facets: queryAiwgFortemiIndex(index).facets,
      parts: refs,
    },
    parts,
  }
}

describe('AIWG Fortemi index adapter', () => {
  it('validates the shared CRM fixture contract', () => {
    const result = validateAiwgFortemiIndexExport(index)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.counts).toMatchObject({
      'crm.contact': 1,
      'crm.organization': 1,
      'crm.event': 1,
      'crm.interaction': 2,
      'aiwg.artifact': 1,
    })
  })

  it('finds CRM records by text, type, facet, tag, and relationship', () => {
    expect(queryAiwgFortemiIndex(index, 'Founder Breakfast').total).toBe(5)
    expect(queryAiwgFortemiIndex(index, '', { types: ['crm.organization'] }).items[0]?.title).toBe('Example Labs')
    expect(queryAiwgFortemiIndex(index, '', { facets: { role: ['sponsor'] } }).items[0]?.id).toContain('sponsor')
    expect(queryAiwgFortemiIndex(index, '', { tags: ['provenance'] }).items[0]?.type).toBe('aiwg.artifact')
    expect(queryAiwgFortemiIndex(index, '', { relationshipTargetId: 'crm:event:fixture-event-1' }).total).toBe(4)
  })

  it('accepts static documentation page records', () => {
    const docsIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        {
          schema_version: 'aiwg.fortemi.index.record.v1',
          id: 'docs:page:pagenary/getting-started',
          type: 'docs.page',
          source: {
            path: 'docs/getting-started.md',
            repo_relative_path: 'docs/getting-started.md',
            locator: 'section:getting-started',
          },
          title: 'Pagenary Getting Started',
          text: 'Pagenary tenants can publish sanitized static documentation for lookup.',
          facets: {
            product: ['pagenary'],
            section: ['getting-started'],
          },
          tags: ['docs', 'lookup'],
          concepts: ['static-index'],
          relationships: [],
          provenance: [
            {
              field: 'text',
              source: 'docs/getting-started.md',
              path: '$.items[0].text',
              confidence: 'source',
              privacy: 'public',
            },
          ],
          privacy: {
            classification: 'public',
            pii: false,
          },
          updated_at: '2026-01-04T00:00:00.000Z',
        },
      ],
    }

    const validation = validateAiwgFortemiIndexExport(docsIndex)
    const result = queryAiwgFortemiIndex(docsIndex, 'tenant', { types: ['docs.page'] })

    expect(validation.valid).toBe(true)
    expect(validation.counts).toMatchObject({ 'docs.page': 1 })
    expect(result.items[0]?.source.locator).toBe('section:getting-started')
  })

  it('returns opt-in ranked results with plain text snippets and matches', () => {
    const result = queryAiwgFortemiIndex(index, 'Example', {
      rank: true,
      snippets: true,
      includeMatches: true,
      snippetLength: 48,
      limit: 2,
      weights: { title: 10, text: 1, tag: 1, concept: 1 },
    })

    expect(result.items).toHaveLength(2)
    expect(result.rankedItems).toHaveLength(2)
    expect(result.rankedItems?.[0]?.rank).toBeGreaterThanOrEqual(result.rankedItems?.[1]?.rank ?? 0)
    expect(result.rankedItems?.[0]?.snippet).toContain('Example')
    expect(result.rankedItems?.[0]?.snippet).not.toContain('<mark>')
    expect(result.rankedItems?.[0]?.matches?.some((match) => match.field === 'title')).toBe(true)
    expect(result.facets.type).toMatchObject({
      'crm.contact': 1,
      'crm.organization': 1,
      'crm.event': 1,
    })
  })

  it('preserves default export ordering and paginates after ranking', () => {
    const defaultResult = queryAiwgFortemiIndex(index, 'Example', { limit: 2 })
    const rankedResult = queryAiwgFortemiIndex(index, 'Example', { rank: true, limit: 2, offset: 1 })

    expect(defaultResult.rankedItems).toBeUndefined()
    expect(defaultResult.items[0]?.id).toBe(index.items[1]?.id)
    expect(rankedResult.rankedItems?.[0]?.item.id).toBe(rankedResult.items[0]?.id)
    expect(rankedResult.total).toBe(defaultResult.total)
  })

  it('exports review decisions without mutating source records', () => {
    const exported = createAiwgReviewDecisionExport(index, [
      {
        item_id: 'crm:interaction:partiful-fixture-person-1:fixture-event-1:host',
        action: 'defer',
        reason: 'needs curator review',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ], '2026-01-03T00:00:00.000Z')

    expect(exported.schema_version).toBe('aiwg.fortemi.review-decisions.v1')
    expect(exported.decisions).toHaveLength(1)
    expect(index.items.find((item) => item.id === exported.decisions[0]?.item_id)?.type).toBe('crm.interaction')
  })

  it('projects relationships into a CommunityGraph', () => {
    const graph = aiwgFortemiIndexToCommunityGraph(index, {
      communityFacet: 'role',
      relationshipWeights: { co_attended: 2 },
    })

    expect(graph.nodes).toHaveLength(index.items.length)
    expect(graph.edges.length).toBeGreaterThan(0)
    expect(graph.edges.every((edge) => edge.source && edge.target && edge.weight > 0)).toBe(true)
    expect(graph.communities.length).toBeGreaterThan(0)
  })

  it('drops dangling relationships by default', () => {
    const graph = aiwgFortemiIndexToCommunityGraph({
      ...index,
      items: [
        {
          ...index.items[0],
          relationships: [{ type: 'missing', target_id: 'does-not-exist' }],
        },
      ],
    })

    expect(graph.nodes).toHaveLength(1)
    expect(graph.edges).toHaveLength(0)
  })

  it('provides a framework-agnostic controller aligned with the React hook workflow', () => {
    const controller = createAiwgIndexController()
    const snapshots: Array<{ hasIndex: boolean; dataTotal: number | null; decisions: number; error: string | null }> = []
    const unsubscribe = controller.subscribe((snapshot) => {
      snapshots.push({
        hasIndex: !!snapshot.index,
        dataTotal: snapshot.data?.total ?? null,
        decisions: snapshot.reviewDecisions.length,
        error: snapshot.error?.message ?? null,
      })
    })

    expect(controller.getIndex()).toBeNull()
    expect(() => controller.query('Example')).toThrow('No AIWG index export loaded')

    const loaded = controller.loadIndex(index)
    const result = controller.query('Example', { rank: true, snippets: true, limit: 1 })
    const graph = controller.toCommunityGraph({ communityFacet: 'role' })
    const decision = controller.setReviewDecision({
      item_id: result.items[0].id,
      action: 'accept',
      reason: 'reviewed in static host',
    })
    const exported = controller.createReviewDecisionExport('2026-01-03T00:00:00.000Z')

    unsubscribe()
    controller.clearReviewDecision(decision.item_id)

    expect(loaded).toBe(index)
    expect(result.rankedItems?.[0]?.snippet).toContain('Example')
    expect(graph.nodes).toHaveLength(index.items.length)
    expect(exported.decisions).toEqual([{ ...decision }])
    expect(controller.getSnapshot().reviewDecisions).toEqual([])
    expect(snapshots.map((snapshot) => snapshot.decisions)).toContain(1)
  })

  it('reports invalid index load errors through the controller snapshot', () => {
    const controller = createAiwgIndexController()
    const errors: string[] = []
    controller.subscribe((snapshot) => {
      if (snapshot.error) errors.push(snapshot.error.message)
    })

    expect(() => controller.loadIndex({ schema_version: 'wrong' })).toThrow('Invalid AIWG Fortemi index export')
    expect(errors[0]).toContain('schema_version must be aiwg.fortemi.index.export.v1')
    expect(controller.getSnapshot().index).toBeNull()
  })

  it('validates chunked index manifests and parts', () => {
    const { manifest, parts } = createChunkedFixture()
    const firstPart = parts.get(manifest.parts[0].href)

    expect(validateAiwgFortemiChunkManifest(manifest)).toEqual({ valid: true, errors: [] })
    expect(validateAiwgFortemiChunkPart(firstPart, manifest.parts[0], manifest)).toEqual({ valid: true, errors: [] })

    expect(validateAiwgFortemiChunkManifest({
      ...manifest,
      parts: [{ ...manifest.parts[0], offset: 1 }],
    }).errors).toContain('parts[0].offset must be 0')
    expect(validateAiwgFortemiChunkPart({
      ...firstPart,
      offset: 99,
    }, manifest.parts[0], manifest).errors).toContain('offset must match manifest part offset 0')
  })

  it('browses chunked indexes by loading only intersecting static parts', async () => {
    const { manifest, parts } = createChunkedFixture(2)
    const loadedHrefs: string[] = []
    const loader: AiwgChunkedIndexLoader = async (part) => {
      loadedHrefs.push(part.href)
      return parts.get(part.href)
    }
    const controller = createAiwgIndexController()

    controller.loadChunkedIndex(manifest, loader, { maxCachedParts: 1 })
    const result = await controller.queryChunked('', { offset: 2, limit: 2 })

    expect(result.items.map((item) => item.id)).toEqual(index.items.slice(2, 4).map((item) => item.id))
    expect(result.total).toBe(index.items.length)
    expect(result.scannedParts).toBe(1)
    expect(result.fetchedParts).toBe(1)
    expect(loadedHrefs).toEqual([manifest.parts[1].href])
    expect(controller.getIndex()).toBeNull()
    expect(controller.getChunkedManifest()).toBe(manifest)
    expect(controller.getSnapshot().chunked?.cachedParts).toBe(1)
  })

  it('runs exact ranked chunked searches with bounded part caching', async () => {
    const { manifest, parts } = createChunkedFixture(2)
    const progress: string[] = []
    const loader: AiwgChunkedIndexLoader = async (part) => parts.get(part.href)
    const controller = createAiwgIndexController()
    const expected = queryAiwgFortemiIndex(index, 'Example', {
      rank: true,
      snippets: true,
      includeMatches: true,
      limit: 2,
    })

    controller.loadChunkedIndex(manifest, loader, { maxCachedParts: 1 })
    const result = await controller.queryChunked('Example', {
      rank: true,
      snippets: true,
      includeMatches: true,
      limit: 2,
      onProgress: (event) => progress.push(`${event.phase}:${event.done}/${event.total}`),
    })

    expect(result.items.map((item) => item.id)).toEqual(expected.items.map((item) => item.id))
    expect(result.rankedItems?.map((entry) => entry.snippet)).toEqual(expected.rankedItems?.map((entry) => entry.snippet))
    expect(result.total).toBe(expected.total)
    expect(result.scannedParts).toBe(manifest.parts.length)
    expect(result.fetchedParts).toBe(manifest.parts.length)
    expect(result.complete).toBe(true)
    expect(progress).toContain(`part:${manifest.parts.length}/${manifest.parts.length}`)
    expect(controller.getSnapshot().chunked?.cachedParts).toBeLessThanOrEqual(1)
  })

  it('exports review decisions in chunked mode without a whole index (#178)', () => {
    const { manifest, parts } = createChunkedFixture(2)
    const loader: AiwgChunkedIndexLoader = async (part) => parts.get(part.href)
    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(manifest, loader, { maxCachedParts: 1 })

    expect(controller.getIndex()).toBeNull() // chunked mode: no whole index

    const decision = controller.setReviewDecision({
      item_id: index.items[0].id,
      action: 'accept',
      reason: 'reviewed against chunked manifest',
    })
    // Previously threw 'No AIWG index export loaded' — the export only needs the
    // export schema_version, not the items.
    const exported = controller.createReviewDecisionExport('2026-01-03T00:00:00.000Z')

    expect(exported.schema_version).toBe('aiwg.fortemi.review-decisions.v1')
    expect(exported.source_export_schema_version).toBe('aiwg.fortemi.index.export.v1')
    expect(exported.generated_at).toBe('2026-01-03T00:00:00.000Z')
    expect(exported.decisions).toEqual([{ ...decision }])
  })

  it('createReviewDecisionExport throws when neither index nor manifest is loaded', () => {
    const controller = createAiwgIndexController()
    expect(() => controller.createReviewDecisionExport()).toThrow(
      /No AIWG index export or chunked manifest loaded/,
    )
  })
})

describe('AIWG Fortemi chunked index — match-set page cache (#179)', () => {
  function countingLoader(parts: Map<string, AiwgFortemiChunkPart>) {
    const calls: string[] = []
    const loader: AiwgChunkedIndexLoader = async (part) => {
      calls.push(part.href)
      return parts.get(part.href)
    }
    return { loader, calls }
  }

  it('reuses the scan across pages of the same query (no re-scan, no re-fetch)', async () => {
    const { manifest, parts } = createChunkedFixture(2)
    const { loader, calls } = countingLoader(parts)
    const controller = createAiwgIndexController()
    // Keep all parts resident so a cache MISS would re-fetch (isolating the
    // match-cache effect from part-cache churn).
    controller.loadChunkedIndex(manifest, loader, { maxCachedParts: manifest.parts.length })

    const page1 = await controller.queryChunked('Example', { rank: true, limit: 2, offset: 0 })
    expect(page1.scannedParts).toBe(manifest.parts.length)
    expect(page1.fetchedParts).toBe(manifest.parts.length)
    expect(page1.total).toBeGreaterThan(2)
    const coldCalls = calls.length
    expect(coldCalls).toBe(manifest.parts.length)

    // Page 2 of the same query: served from the cached match set — no part work.
    const page2 = await controller.queryChunked('Example', { rank: true, limit: 2, offset: 2 })
    expect(page2.scannedParts).toBe(0)
    expect(page2.fetchedParts).toBe(0)
    expect(calls.length).toBe(coldCalls)
    expect(page2.total).toBe(page1.total)

    // Identical to paging the whole index — the cache changes cost, not results.
    const whole1 = queryAiwgFortemiIndex(index, 'Example', { rank: true, limit: 2, offset: 0 })
    const whole2 = queryAiwgFortemiIndex(index, 'Example', { rank: true, limit: 2, offset: 2 })
    expect(page1.items.map((item) => item.id)).toEqual(whole1.items.map((item) => item.id))
    expect(page2.items.map((item) => item.id)).toEqual(whole2.items.map((item) => item.id))
  })

  it('does not serve a cached set when filters/weights change', async () => {
    const { manifest, parts } = createChunkedFixture(2)
    const { loader, calls } = countingLoader(parts)
    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(manifest, loader, { maxCachedParts: manifest.parts.length })

    await controller.queryChunked('Example', { rank: true, limit: 2 })
    const callsAfterCold = calls.length

    // Adding a type filter is a different match set → re-scan (part cache warm,
    // so scanned but not re-fetched).
    const filtered = await controller.queryChunked('Example', {
      rank: true,
      limit: 2,
      types: ['crm.interaction'],
    })
    expect(filtered.scannedParts).toBe(manifest.parts.length)
    expect(filtered.fetchedParts).toBe(0)
    expect(calls.length).toBe(callsAfterCold)
    const expectedFiltered = queryAiwgFortemiIndex(index, 'Example', {
      rank: true,
      limit: 2,
      types: ['crm.interaction'],
    })
    expect(filtered.items.map((item) => item.id)).toEqual(expectedFiltered.items.map((item) => item.id))
    expect(filtered.total).toBe(expectedFiltered.total)

    // The original query still hits its own cached set.
    const again = await controller.queryChunked('Example', { rank: true, limit: 2, offset: 2 })
    expect(again.scannedParts).toBe(0)
    expect(again.fetchedParts).toBe(0)
  })

  it('clearChunkCache drops the match set so the next query re-scans', async () => {
    const { manifest, parts } = createChunkedFixture(2)
    const { loader, calls } = countingLoader(parts)
    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(manifest, loader, { maxCachedParts: manifest.parts.length })

    await controller.queryChunked('Example', { rank: true, limit: 2 })
    const coldCalls = calls.length
    controller.clearChunkCache()

    const after = await controller.queryChunked('Example', { rank: true, limit: 2 })
    expect(after.scannedParts).toBe(manifest.parts.length)
    expect(after.fetchedParts).toBe(manifest.parts.length)
    expect(calls.length).toBe(coldCalls + manifest.parts.length)
  })

  it('bounds the cache by total entries (LRU-evicts older match sets)', async () => {
    const { manifest, parts } = createChunkedFixture(2)
    const { loader, calls } = countingLoader(parts)
    const controller = createAiwgIndexController()
    // maxCachedMatches: 1 entry total → each distinct query evicts the previous.
    controller.loadChunkedIndex(manifest, loader, {
      maxCachedParts: manifest.parts.length,
      maxCachedMatches: 1,
    })

    await controller.queryChunked('Example', { rank: true, limit: 2 }) // set A (>1 entry)
    await controller.queryChunked('crm', { rank: true, limit: 2 }) // set B evicts A
    const callsBeforeReplay = calls.length

    // A was evicted → re-scan (parts warm, so scanned not fetched).
    const replayA = await controller.queryChunked('Example', { rank: true, limit: 2, offset: 2 })
    expect(replayA.scannedParts).toBe(manifest.parts.length)
    expect(replayA.fetchedParts).toBe(0)
    expect(calls.length).toBe(callsBeforeReplay)
  })
})

describe('AIWG Fortemi chunked index — slim/projected parts (#168)', () => {
  const projection = AIWG_SCAN_REQUIRED_FIELDS

  function projectedRuntime(partSize = 2) {
    const built = buildAiwgChunkedIndex(index, { partSize, projection })
    const partsByHref = new Map(built.parts.map((entry) => [entry.href, entry.part]))
    const detailById = new Map(built.details.map((entry) => [entry.id, entry.record]))
    let detailFetches = 0
    const loader: AiwgChunkedIndexLoader = async (ref) => partsByHref.get(ref.href)
    const detailLoader: AiwgChunkedIndexDetailLoader = async (id) => {
      detailFetches += 1
      return detailById.get(id)
    }
    return { built, loader, detailLoader, detailFetches: () => detailFetches }
  }

  it('builds a projected manifest + slim parts + full detail records', () => {
    const built = buildAiwgChunkedIndex(index, { partSize: 2, projection })
    expect(built.manifest.projection).toEqual(projection)
    expect(built.manifest.detail?.href).toBe('detail/{id}.json')
    // manifest facets computed from FULL records → exact global counts even though parts are slim
    expect(built.manifest.facets?.type?.['crm.organization']).toBe(1)
    // slim parts omit detail-only fields, keep scan fields
    const firstItem = built.parts[0].part.items[0] as unknown as Record<string, unknown>
    expect(firstItem.title).toBeDefined()
    expect(firstItem.facets).toBeDefined()
    expect(firstItem.source).toBeUndefined()
    expect(firstItem.provenance).toBeUndefined()
    expect(firstItem.relationships).toBeUndefined()
    // every record has a full detail entry
    expect(built.details.length).toBe(index.items.length)
    expect(built.details[0].record.provenance.length).toBeGreaterThan(0)
  })

  it('builds whole-record parts (no projection, no detail) by default', () => {
    const built = buildAiwgChunkedIndex(index, { partSize: 2 })
    expect(built.manifest.projection).toBeUndefined()
    expect(built.manifest.detail).toBeUndefined()
    expect(built.details).toEqual([])
    expect((built.parts[0].part.items[0] as unknown as Record<string, unknown>).provenance).toBeDefined()
  })

  it('validates a projected manifest and projected parts', () => {
    const { built } = projectedRuntime()
    expect(validateAiwgFortemiChunkManifest(built.manifest)).toEqual({ valid: true, errors: [] })
    const part = built.parts[0].part
    expect(validateAiwgFortemiChunkPart(part, built.manifest.parts[0], built.manifest)).toEqual({ valid: true, errors: [] })
  })

  it('rejects a projection missing scan-required fields and a detail href without {id}', () => {
    const { built } = projectedRuntime()
    const badProjection = validateAiwgFortemiChunkManifest({ ...built.manifest, projection: ['id', 'type'] })
    expect(badProjection.valid).toBe(false)
    expect(badProjection.errors.some((e) => e.includes('scan-required field title'))).toBe(true)
    const badDetail = validateAiwgFortemiChunkManifest({ ...built.manifest, detail: { href: 'detail.json' } })
    expect(badDetail.valid).toBe(false)
    expect(badDetail.errors.some((e) => e.includes('{id}'))).toBe(true)
  })

  it('queries projected parts with the same results as the whole index, then lazy-loads detail', async () => {
    const { built, loader, detailLoader, detailFetches } = projectedRuntime()
    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(built.manifest, loader, { detailLoader, maxCachedParts: 1, maxCachedDetails: 4 })

    // scan parity with the in-memory query (ids + totals)
    const chunked = await controller.queryChunked('', { types: ['crm.organization'] })
    const inMemory = queryAiwgFortemiIndex(index, '', { types: ['crm.organization'] })
    expect(chunked.items.map((item) => item.id)).toEqual(inMemory.items.map((item) => item.id))
    expect(chunked.total).toBe(inMemory.total)

    // the scanned item is slim — detail not fetched yet
    const slim = chunked.items[0] as unknown as Record<string, unknown>
    expect(slim.provenance).toBeUndefined()
    expect(detailFetches()).toBe(0)

    // getRecord resolves the full record on demand and caches it
    const full = await controller.getRecord(chunked.items[0].id)
    expect(full.provenance.length).toBeGreaterThan(0)
    expect(full.source.path).toBeTruthy()
    expect(detailFetches()).toBe(1)
    await controller.getRecord(chunked.items[0].id)
    expect(detailFetches()).toBe(1) // served from detail cache
  })

  it('rejects getRecord on a projected index without a detailLoader', async () => {
    const { built, loader } = projectedRuntime()
    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(built.manifest, loader)
    await expect(controller.getRecord(index.items[0].id)).rejects.toThrow(/detailLoader/)
  })
})

describe('AIWG Fortemi chunked index — path-safe detail id encoding (#177)', () => {
  const projection = AIWG_SCAN_REQUIRED_FIELDS
  // Two slash-containing ids — the case that breaks encodeURIComponent on static hosts.
  const slashIndex: AiwgFortemiIndexExport = {
    ...index,
    items: [
      { ...index.items[0], id: 'aiwg:artifact:.aiwg/.milestones.json' },
      { ...index.items[1], id: 'docs:page:product/getting-started' },
    ],
  }

  afterEach(() => vi.unstubAllGlobals())

  it('encodeAiwgDetailId base64url yields a single path-safe segment for slash ids', () => {
    const encoded = encodeAiwgDetailId('aiwg:artifact:.aiwg/.milestones.json')
    expect(encoded).not.toMatch(/[/%+=\n]/) // no path sep, no percent, no base64 +/=
    expect(encoded).toBe(encodeAiwgDetailId('aiwg:artifact:.aiwg/.milestones.json')) // deterministic
    // uri mode preserves the legacy behavior
    expect(encodeAiwgDetailId('a/b', 'uri')).toBe('a%2Fb')
  })

  it('aiwgDetailHrefForId honors encoding (base64url path-safe, absent → legacy uri)', () => {
    const id = 'docs:page:product/getting-started'
    const b64 = aiwgDetailHrefForId({ href: 'detail/{id}.json', encoding: 'base64url' }, id)
    expect(b64.startsWith('detail/')).toBe(true)
    expect(b64.endsWith('.json')).toBe(true)
    expect(b64).not.toContain('%2F')
    // No encoding → backward-compatible uri behavior.
    expect(aiwgDetailHrefForId({ href: 'detail/{id}.json' }, id)).toContain('%2F')
  })

  it('buildAiwgChunkedIndex defaults to base64url and emits encoding-correct detail hrefs', () => {
    const built = buildAiwgChunkedIndex(slashIndex, { partSize: 2, projection })
    expect(built.manifest.detail?.encoding).toBe('base64url')
    expect(validateAiwgFortemiChunkManifest(built.manifest).valid).toBe(true)
    for (const detail of built.details) {
      expect(detail.href).toBe(aiwgDetailHrefForId(built.manifest.detail!, detail.id))
      expect(detail.href).not.toContain('%2F') // path-safe even for slash ids
    }
  })

  it('supports opt-in uri encoding for backward compatibility', () => {
    const built = buildAiwgChunkedIndex(slashIndex, { partSize: 2, projection, idEncoding: 'uri' })
    expect(built.manifest.detail?.encoding).toBe('uri')
    const slashDetail = built.details.find((d) => d.id.includes('/'))!
    expect(slashDetail.href).toContain('%2F')
  })

  it('resolves slash-containing detail records end-to-end (writer + loader agree)', async () => {
    const built = buildAiwgChunkedIndex(slashIndex, { partSize: 2, projection })
    const partsByHref = new Map(built.parts.map((entry) => [entry.href, entry.part]))
    // Host writes each detail at its emitted (base64url) href.
    const detailByHref = new Map(built.details.map((entry) => [entry.href, entry.record]))

    const loader: AiwgChunkedIndexLoader = async (ref) => partsByHref.get(ref.href)
    // Loader resolves the same href via the manifest's encoding — must match the writer.
    const detailLoader: AiwgChunkedIndexDetailLoader = async (id, manifest) =>
      detailByHref.get(aiwgDetailHrefForId(manifest.detail!, id))

    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(built.manifest, loader, { detailLoader, maxCachedParts: 1 })

    const record = await controller.getRecord('aiwg:artifact:.aiwg/.milestones.json')
    expect(record.id).toBe('aiwg:artifact:.aiwg/.milestones.json')
    expect(record.provenance.length).toBeGreaterThan(0) // full record, not slim
  })

  it('createAiwgFetchDetailLoader fetches the base64url path for slash ids', async () => {
    const built = buildAiwgChunkedIndex(slashIndex, { partSize: 2, projection })
    const id = 'aiwg:artifact:.aiwg/.milestones.json'
    const record = built.details.find((d) => d.id === id)!.record
    const requested: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url)
      return new Response(JSON.stringify(record), { status: 200 })
    })

    const detailLoader = createAiwgFetchDetailLoader('https://static.example/index/')
    const raw = await detailLoader(id, built.manifest)

    expect(requested).toHaveLength(1)
    expect(requested[0]).not.toContain('%2F') // base64url, not %2F
    expect((raw as { id: string }).id).toBe(id)
  })

  it('validates detail.encoding values', () => {
    const built = buildAiwgChunkedIndex(slashIndex, { partSize: 2, projection })
    const bad = validateAiwgFortemiChunkManifest({
      ...built.manifest,
      detail: { href: 'detail/{id}.json', encoding: 'bogus' },
    })
    expect(bad.errors).toContain("detail.encoding must be 'uri' or 'base64url'")
    const uriOk = validateAiwgFortemiChunkManifest({
      ...built.manifest,
      detail: { href: 'detail/{id}.json', encoding: 'uri' },
    })
    expect(uriOk.valid).toBe(true)
  })
})
