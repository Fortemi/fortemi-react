import { describe, expect, it } from 'vitest'
import {
  aiwgFortemiIndexToCommunityGraph,
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
})
