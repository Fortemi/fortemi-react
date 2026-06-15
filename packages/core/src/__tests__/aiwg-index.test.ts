import { describe, expect, it } from 'vitest'
import {
  aiwgFortemiIndexToCommunityGraph,
  createAiwgIndexController,
  createAiwgReviewDecisionExport,
  queryAiwgFortemiIndex,
  validateAiwgFortemiIndexExport,
  type AiwgFortemiIndexExport,
} from '../aiwg-index.js'
import fixture from '../../test/fixtures/sanitized-aiwg-fortemi-index.json' with { type: 'json' }

const index = fixture as unknown as AiwgFortemiIndexExport

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
})
