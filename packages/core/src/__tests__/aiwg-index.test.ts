import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AIWG_SCAN_REQUIRED_FIELDS,
  aiwgDetailHrefForId,
  aiwgFortemiIndexToCommunityGraph,
  buildAiwgChunkedIndex,
  buildAiwgStaticEmbeddingSet,
  createAiwgFetchDetailLoader,
  createAiwgIndexController,
  createAiwgReviewDecisionExport,
  encodeAiwgDetailId,
  filterAiwgRecordsByPrivacy,
  findAiwgStaticDuplicatePairs,
  getAiwgFortemiFacets,
  resolveAiwgFetchUrl,
  queryAiwgHybridIndex,
  queryAiwgFortemiIndex,
  queryAiwgSemanticIndex,
  validateAiwgFortemiChunkManifest,
  validateAiwgFortemiChunkPart,
  validateAiwgFortemiIndexExport,
  validateAiwgStaticEmbeddingSet,
  type AiwgChunkedIndexDetailLoader,
  type AiwgChunkedIndexLoader,
  type AiwgFortemiChunkManifest,
  type AiwgFortemiChunkPart,
  type AiwgFortemiIndexExport,
  type AiwgFortemiRecord,
  type AiwgStaticEmbeddingSet,
} from '../aiwg-index.js'
import fixture from '../../test/fixtures/sanitized-aiwg-fortemi-index.json' with { type: 'json' }

const index = fixture as unknown as AiwgFortemiIndexExport

function record(id: string, type: string, title: string, text: string, overrides: Partial<AiwgFortemiRecord> = {}): AiwgFortemiRecord {
  return {
    ...index.items[0],
    schema_version: 'aiwg.fortemi.index.record.v1',
    id,
    type,
    title,
    text,
    source: {
      path: `${id}.md`,
      repo_relative_path: `${id}.md`,
      locator: id,
    },
    facets: {},
    tags: [],
    concepts: [],
    relationships: [],
    provenance: [
      {
        field: 'text',
        source: `${id}.md`,
        path: '$.text',
        confidence: 'source',
        privacy: 'public',
      },
    ],
    privacy: { classification: 'public', pii: false },
    updated_at: '2026-01-04T00:00:00.000Z',
    ...overrides,
  }
}

function v2Record(id: string, type: string, overrides: Partial<AiwgFortemiRecord> = {}): AiwgFortemiRecord {
  return {
    ...record(id, type, id, ''),
    schema_version: 'aiwg.fortemi.index.record.v2',
    source: {
      path: `${id}.md`,
      repo_relative_path: `${id}.md`,
      locator: id,
      origin: 'aiwg',
      generated: true,
      checksum: `sha256:${id}`,
      updated_at: '2026-07-02T00:00:00.000Z',
    },
    search: {
      title: id,
      name: id.split(':').at(-1),
      summary: '',
      body: '',
      triggers: [],
      aliases: [],
      capability: type,
      tags: [],
      phase: 'construction',
      type,
      frontmatter: {},
    },
    chunks: [],
    embeddings: [],
    compatibility: { v1_strategy: 'preserve-flat-fields' },
    privacy: { classification: 'public', pii: false, locality: 'workspace' },
    ...overrides,
  }
}

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
          schema_version: 'aiwg.fortemi.index.record.v2',
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
          relationships: [
            {
              type: 'documents',
              target_id: 'aiwg:artifact:.aiwg/architecture/0003-provenance-per-field.md',
              label: 'Documents provenance model',
              confidence: 0.94,
              privacy: 'public',
              metadata: { section: 'metadata' },
            },
          ],
          provenance: [
            {
              field: 'text',
              source: 'docs/getting-started.md',
              path: '$.items[0].text',
              confidence: 'source',
              privacy: 'public',
            },
          ],
          skos_concepts: [
            {
              id: 'concept:static-index',
              prefLabel: 'Static Index',
              definition: 'A prebuilt static search and metadata record set.',
              scheme: 'fortemi-docs',
              notation: 'IDX',
              uri: 'https://example.test/concepts/static-index',
              altLabels: ['aiwg index'],
              metadata: { source: 'pagenary' },
            },
          ],
          skos_relations: [
            {
              type: 'broader',
              source_id: 'concept:static-index',
              target_id: 'concept:documentation',
              metadata: { confidence: 0.88 },
            },
          ],
          provenance_events: [
            {
              id: 'prov:docs-page-import',
              activity: 'generated',
              agent: 'aiwg-index',
              started_at: '2026-01-04T00:00:00.000Z',
              ended_at: '2026-01-04T00:00:02.000Z',
              source: 'docs/getting-started.md',
              path: '$.items[0]',
              confidence: 'source',
              privacy: 'public',
              attributes: { generator: 'pagenary' },
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
    expect(result.items[0]?.skos_concepts?.[0]?.prefLabel).toBe('Static Index')
    expect(result.items[0]?.provenance_events?.[0]?.activity).toBe('generated')
    expect(result.total).toBe(1)
  })

  it('keeps rich metadata optional and validates malformed rich fields when present', () => {
    const optionalIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [{ ...index.items[0] }],
    }

    const invalidIndex = {
      ...index,
      items: [
        {
          ...index.items[0],
          skos_concepts: [{ id: 'concept:missing-label' }],
          skos_relations: [{ type: 'broader', source_id: 'concept:a' }],
          provenance_events: [{ agent: 'indexer' }],
          relationships: [{ type: 'related', target_id: 'record:b', metadata: [] }],
        },
      ],
    }

    expect(validateAiwgFortemiIndexExport(optionalIndex).valid).toBe(true)
    const invalid = validateAiwgFortemiIndexExport(invalidIndex)
    expect(invalid.valid).toBe(false)
    expect(invalid.errors).toContain('items[0].skos_concepts[0].prefLabel is required')
    expect(invalid.errors).toContain('items[0].skos_relations[0].target_id is required')
    expect(invalid.errors).toContain('items[0].provenance_events[0].activity is required')
    expect(invalid.errors).toContain('items[0].relationships[0].metadata must be an object')
  })

  it('accepts project-specific AIWG and research record types and facets them by type', () => {
    const aiwgIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('aiwg:command:discover', 'aiwg.command', 'AIWG Discover', 'Find AIWG capabilities.'),
        record('aiwg:requirement:search', 'aiwg.requirement', 'Search Requirement', 'Static search contract.'),
        record('aiwg:rule:delivery', 'aiwg.rule', 'Delivery Rule', 'Delivery guardrails.'),
        record('aiwg:skill:doctor', 'aiwg.skill', 'AIWG Doctor', 'Workspace health check.'),
        record('research:ref:001', 'research.ref', 'REF-001', 'Research citation.'),
      ],
    }

    const validation = validateAiwgFortemiIndexExport(aiwgIndex)
    const result = queryAiwgFortemiIndex(aiwgIndex, '', { types: ['aiwg.skill', 'research.ref'] })

    expect(validation.valid).toBe(true)
    expect(validation.counts).toMatchObject({
      'aiwg.command': 1,
      'aiwg.requirement': 1,
      'aiwg.rule': 1,
      'aiwg.skill': 1,
      'research.ref': 1,
    })
    expect(result.items.map((item) => item.type)).toEqual(['aiwg.skill', 'research.ref'])
    expect(result.facets.type).toMatchObject({ 'aiwg.skill': 1, 'research.ref': 1 })
  })

  it('accepts AIWG Fortemi v2 all-domain exports and queries v2 search/chunk projections', () => {
    const v2Index: AiwgFortemiIndexExport = {
      ...index,
      schema_version: 'aiwg.fortemi.index.export.v2',
      source: {
        repo: 'Fortemi/fortemi-react',
        privacy: 'public',
        graph: { communities: 2 },
      },
      compatibility: { v1_strategy: 'flat-fields-plus-v2-projection' },
      items: [
        v2Record('aiwg:agent:planner', 'aiwg.agent', {
          title: undefined,
          text: undefined,
          search: {
            title: 'Planner Agent',
            name: 'planner',
            summary: 'Coordinates construction phase work.',
            body: 'Planner agent handles acceptance criteria and issue decomposition.',
            triggers: ['plan implementation'],
            aliases: ['planning agent'],
            capability: 'planning',
            tags: ['agent', 'sdlc'],
            phase: 'construction',
            type: 'aiwg.agent',
            frontmatter: { owner: 'aiwg' },
          },
          chunks: [{ id: 'chunk-1', text: 'Chunked planner body for static search parity.' }],
        }),
        v2Record('aiwg:bundle:sdlc', 'aiwg.bundle', {
          search: { title: 'SDLC Bundle', summary: 'Complete SDLC bundle.', body: 'Bundle record.', tags: ['bundle'] },
        }),
        v2Record('aiwg:command:address-issues', 'aiwg.command', {
          search: { title: 'address-issues', body: 'Address open issues.', triggers: ['address the open issues'] },
        }),
        v2Record('aiwg:flow:release', 'aiwg.flow', {
          search: { title: 'Release Flow', summary: 'Release orchestration.', body: 'Ship release.' },
        }),
        v2Record('aiwg:issue:219', 'aiwg.issue', {
          search: { title: 'Issue 219', summary: 'Accept v2 records.', body: 'Fortemi v2 export acceptance.' },
        }),
        v2Record('aiwg:kb:page:index', 'aiwg.kb.page', {
          search: { title: 'KB Index', summary: 'Knowledge base graph page.', body: 'Semantic memory and KB page.' },
        }),
        v2Record('aiwg:memory:entry:001', 'aiwg.memory.entry', {
          search: { title: 'Memory Entry', summary: 'Memory graph entry.', body: 'Remember graph traversal.' },
        }),
        v2Record('aiwg:research:profile:alice', 'aiwg.research.profile', {
          search: { title: 'Alice Profile', summary: 'Research profile.', body: 'Profile graph node.' },
        }),
        v2Record('aiwg:research:ref:001', 'aiwg.research.ref', {
          search: { title: 'REF-001', summary: 'Research reference.', body: 'Citation graph reference.' },
        }),
        v2Record('aiwg:research:synthesis:001', 'aiwg.research.synthesis', {
          search: { title: 'Synthesis', summary: 'Research synthesis.', body: 'Synthesized evidence.' },
        }),
        v2Record('aiwg:research:view:001', 'aiwg.research.view', {
          search: { title: 'Research View', summary: 'Research view.', body: 'View projection.' },
        }),
        v2Record('aiwg:rule:delivery', 'aiwg.rule', {
          search: { title: 'Delivery Rule', summary: 'Delivery policy.', body: 'PR required.' },
        }),
        v2Record('aiwg:skill:doctor', 'aiwg.skill', {
          search: { title: 'AIWG Doctor', summary: 'Workspace health.', body: 'Doctor checks workspace.' },
        }),
      ].sort((left, right) => left.id.localeCompare(right.id)),
    }

    const validation = validateAiwgFortemiIndexExport(v2Index)
    const projectionResult = queryAiwgFortemiIndex(v2Index, 'acceptance criteria', { searchProfile: 'aiwg-discovery' })
    const chunkResult = queryAiwgFortemiIndex(v2Index, 'chunked planner body')

    expect(validation.valid).toBe(true)
    expect(validation.counts).toMatchObject({
      'aiwg.agent': 1,
      'aiwg.command': 1,
      'aiwg.flow': 1,
      'aiwg.kb.page': 1,
      'aiwg.memory.entry': 1,
      'aiwg.research.ref': 1,
      'aiwg.skill': 1,
    })
    expect(projectionResult.items[0]?.id).toBe('aiwg:agent:planner')
    expect(chunkResult.items[0]?.id).toBe('aiwg:agent:planner')
  })

  it('ranks AIWG discovery queries by canonical names, triggers, capabilities, and relaxed tokens', () => {
    const discoveryIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('skill:aiwg-doctor', 'aiwg.skill', 'AIWG Doctor', 'Runs diagnostics.', {
          facets: { trigger: ['check workspace health'], capability: ['doctor status health diagnostics'] },
          tags: ['health'],
        }),
        record('command:address-issues', 'aiwg.command', 'Address Issues', 'Implements tracker issue loops.', {
          facets: { trigger: ['address the open issues'], capability: ['issue thread implementation loop'] },
          tags: ['issues'],
        }),
        record('docs:path-only', 'docs.page', 'Generated Command Directory', 'Path reference only.', {
          source: { path: 'commands/address-issues.md', repo_relative_path: 'commands/address-issues.md', locator: 'path' },
        }),
      ],
    }

    const exact = queryAiwgFortemiIndex(discoveryIndex, 'aiwg doctor', {
      rank: true,
      includeMatches: true,
      searchProfile: 'aiwg-discovery',
    })
    const trigger = queryAiwgFortemiIndex(discoveryIndex, 'please address the open issues', {
      rank: true,
      includeMatches: true,
      searchProfile: 'aiwg-discovery',
    })

    expect(exact.items[0].id).toBe('skill:aiwg-doctor')
    expect(exact.rankedItems?.[0]?.matches?.some((match) => match.reason?.includes('canonical'))).toBe(true)
    expect(trigger.items[0].id).toBe('command:address-issues')
    expect(trigger.items.at(-1)?.id).toBe('docs:path-only')
    expect(trigger.rankedItems?.[0]?.matches?.some((match) => match.reason === 'trigger phrase')).toBe(true)
  })

  it('matches the AIWG query-engine golden discovery ordering (#240)', () => {
    const discoveryIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('aiwg:skill:address-issues', 'aiwg.skill', 'Address Issues', 'Issue-thread-driven agent loops.', {
          search: {
            name: 'address-issues',
            title: 'Address Issues',
            summary: 'Address open issues using issue-thread-driven agent loops with 2-way human-AI collaboration',
            body: 'Tracker implementation loop with cycle comments and verification.',
            triggers: ['address issues 17, 18, and 19', 'fix open issues'],
            capability: 'Address open issues using issue-thread-driven agent loops',
            tags: ['issues', 'tracker'],
            type: 'skill',
          },
          tags: ['issues', 'tracker'],
        }),
        record('aiwg:skill:issue-audit', 'aiwg.skill', 'Issue Audit', 'Read-only backlog triage.', {
          search: {
            name: 'issue-audit',
            title: 'Issue Audit',
            summary: 'Audit open issues without implementing fixes',
            body: 'Summarize issue backlog health and closure candidates.',
            triggers: ['audit open issues'],
            capability: 'Read-only issue triage',
            tags: ['issues', 'audit'],
            type: 'skill',
          },
          tags: ['issues', 'audit'],
        }),
        record('aiwg:skill:aiwg-doctor', 'aiwg.skill', 'AIWG Doctor', 'Workspace diagnostics.', {
          search: {
            name: 'aiwg-doctor',
            title: 'AIWG Doctor',
            summary: 'Run workspace health diagnostics',
            body: 'Checks AIWG installation and project wiring.',
            triggers: ['aiwg doctor', 'workspace health'],
            capability: 'Workspace health check',
            tags: ['health'],
            type: 'skill',
          },
          tags: ['health'],
        }),
        record('docs:commands:address-issues', 'docs.page', 'Generated command directory', 'Path-only command reference.', {
          source: {
            path: 'commands/address-issues.md',
            repo_relative_path: 'commands/address-issues.md',
            locator: 'commands/address-issues.md',
          },
        }),
      ],
    }

    const issueLoop = queryAiwgFortemiIndex(discoveryIndex, 'find a skill that handles issue loops', {
      rank: true,
      includeMatches: true,
      searchProfile: 'aiwg-discovery',
    })
    const exact = queryAiwgFortemiIndex(discoveryIndex, 'aiwg doctor', {
      rank: true,
      includeMatches: true,
      searchProfile: 'aiwg-discovery',
    })
    const typo = queryAiwgFortemiIndex(discoveryIndex, 'aiwg doctro', {
      rank: true,
      includeMatches: true,
      searchProfile: 'aiwg-discovery',
    })

    expect(issueLoop.items.map((item) => item.id)).toEqual([
      'aiwg:skill:address-issues',
      'aiwg:skill:issue-audit',
      'docs:commands:address-issues',
    ])
    expect(issueLoop.rankedItems?.[0]?.rank).toBeLessThanOrEqual(1)
    expect(issueLoop.rankedItems?.[0]?.matches?.some((match) => match.reason === 'capability overlap')).toBe(true)
    expect(exact.items[0].id).toBe('aiwg:skill:aiwg-doctor')
    expect(exact.rankedItems?.[0]?.rank).toBe(1.001)
    expect(typo.items[0].id).toBe('aiwg:skill:aiwg-doctor')
    expect(typo.rankedItems?.[0]?.rank).toBe(0.951)
  })

  it('queries static AIWG embedding sets semantically, hybrid-ranks with lexical fallback, and reports duplicates', () => {
    const semanticIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('aiwg:skill:search', 'aiwg.skill', 'Search Skill', 'Find static index entries.'),
        record('aiwg:command:search', 'aiwg.command', 'Search Command', 'Run static search.'),
        record('aiwg:rule:lexical', 'aiwg.rule', 'Lexical Only Rule', 'Lexical fallback without vectors.'),
        record('research:ref:dedup', 'research.ref', 'Duplicate Research', 'Similar research body.'),
      ],
    }
    const embeddingSet: AiwgStaticEmbeddingSet = {
      schema_version: 'aiwg.fortemi.embedding.set.v1',
      id: 'aiwg-static-test',
      model: 'test-embed',
      dimensions: 3,
      generated_at: '2026-01-04T00:00:00.000Z',
      granularity: 'body',
      input_hash_algorithm: 'sha256',
      embeddings: [
        { record_id: 'aiwg:skill:search', embedding: [1, 0, 0], input_hash: 'hash-skill' },
        { record_id: 'aiwg:command:search', embedding: [0.95, 0.05, 0], input_hash: 'hash-command' },
        { record_id: 'research:ref:dedup', embedding: [0, 1, 0], input_hash: 'hash-ref' },
      ],
    }

    const validation = validateAiwgStaticEmbeddingSet(embeddingSet)
    const semantic = queryAiwgSemanticIndex(semanticIndex, embeddingSet, [1, 0, 0], { limit: 2 })
    const hybrid = queryAiwgHybridIndex(semanticIndex, embeddingSet, 'lexical', [1, 0, 0], { limit: 4 })
    const duplicates = findAiwgStaticDuplicatePairs(semanticIndex, embeddingSet, 0.94)
    const invalid = validateAiwgStaticEmbeddingSet({
      ...embeddingSet,
      embeddings: [{ record_id: 'aiwg:skill:search', embedding: [1, 0, 0] }],
    })

    expect(validation).toEqual({ valid: true, errors: [] })
    expect(semantic.map((entry) => entry.item.id)).toEqual(['aiwg:skill:search', 'aiwg:command:search'])
    expect(hybrid.map((entry) => entry.item.id)).toContain('aiwg:rule:lexical')
    expect(hybrid.find((entry) => entry.item.id === 'aiwg:rule:lexical')?.embedding).toBeUndefined()
    expect(duplicates.map((pair) => [pair.left.id, pair.right.id])).toEqual([['aiwg:skill:search', 'aiwg:command:search']])
    expect(invalid.errors).toContain('embeddings[0].input_hash is required')
  })

  it('hybrid-ranks before applying pagination', () => {
    const semanticIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('aiwg:rule:lexical-top', 'aiwg.rule', 'Alpha policy', 'alpha body'),
        record('aiwg:skill:semantic-top', 'aiwg.skill', 'Alpha runner', 'body'),
      ],
    }
    const embeddingSet: AiwgStaticEmbeddingSet = {
      schema_version: 'aiwg.fortemi.embedding.set.v1',
      id: 'aiwg-static-hybrid-pagination',
      model: 'test-embed',
      dimensions: 1,
      generated_at: '2026-01-04T00:00:00.000Z',
      granularity: 'body',
      input_hash_algorithm: 'sha256',
      embeddings: [
        { record_id: 'aiwg:rule:lexical-top', embedding: [0], input_hash: 'hash-lexical' },
        { record_id: 'aiwg:skill:semantic-top', embedding: [1], input_hash: 'hash-semantic' },
      ],
    }

    const full = queryAiwgHybridIndex(semanticIndex, embeddingSet, 'alpha', [1], {
      lexicalWeight: 0.9,
      semanticWeight: 0.1,
      limit: 10,
    })
    const secondPage = queryAiwgHybridIndex(semanticIndex, embeddingSet, 'alpha', [1], {
      lexicalWeight: 0.9,
      semanticWeight: 0.1,
      limit: 1,
      offset: 1,
    })

    expect(full.map((entry) => entry.item.id)).toEqual(['aiwg:rule:lexical-top', 'aiwg:skill:semantic-top'])
    expect(secondPage.map((entry) => entry.item.id)).toEqual(['aiwg:skill:semantic-top'])
  })

  it('builds AIWG embedding-set sidecars from a headless backend and extracted attachment text', async () => {
    const semanticIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('docs:page:invoice', 'docs.page', 'Invoice', 'Base note text', {
          binary_sources: [
            {
              extracted_text: 'Attachment OCR total due',
              attachment: {
                id: 'att-1',
                path: 'invoice.pdf',
                mime: 'application/pdf',
                checksum: 'sha256:abc',
                bytes: 2048,
              },
            },
          ],
        }),
      ],
    }
    const seenInputs: string[] = []
    const embeddingSet = await buildAiwgStaticEmbeddingSet(semanticIndex, {
      id: 'cli-headless',
      generatedAt: '2026-07-04T00:00:00.000Z',
      backend: {
        model: 'node-test-embedder',
        dimensions: 3,
        embed(input) {
          seenInputs.push(input)
          return [input.includes('Attachment OCR') ? 1 : 0, 0, 0]
        },
      },
    })

    expect(globalThis.document).toBeUndefined()
    expect(seenInputs[0]).toContain('Attachment OCR total due')
    expect(validateAiwgStaticEmbeddingSet(embeddingSet)).toEqual({ valid: true, errors: [] })
    expect(embeddingSet).toMatchObject({
      schema_version: 'aiwg.fortemi.embedding.set.v1',
      id: 'cli-headless',
      model: 'node-test-embedder',
      dimensions: 3,
      granularity: 'body',
      input_hash_algorithm: 'sha256',
      embeddings: [
        {
          record_id: 'docs:page:invoice',
          embedding: [1, 0, 0],
          input_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          source_path: 'docs:page:invoice.md',
        },
      ],
    })
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

  it('does not serve a cached set when the search profile changes', async () => {
    const { manifest, parts } = createChunkedFixture(2)
    const { loader, calls } = countingLoader(parts)
    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(manifest, loader, { maxCachedParts: manifest.parts.length })

    await controller.queryChunked('Example', { rank: true, limit: 2 })
    const callsAfterDefault = calls.length

    const discovery = await controller.queryChunked('Example', {
      rank: true,
      limit: 2,
      searchProfile: 'aiwg-discovery',
    })
    const expected = queryAiwgFortemiIndex(index, 'Example', {
      rank: true,
      limit: 2,
      searchProfile: 'aiwg-discovery',
    })

    expect(discovery.scannedParts).toBe(manifest.parts.length)
    expect(discovery.fetchedParts).toBe(0)
    expect(calls.length).toBe(callsAfterDefault)
    expect(discovery.items.map((item) => item.id)).toEqual(expected.items.map((item) => item.id))
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
    // Projection tests exercise the full fixture; opt in past the SEC6 default
    // privacy filter (#243) so private/pii fixture records are still projected.
    const built = buildAiwgChunkedIndex(index, {
      partSize,
      projection,
      privacy: { includePrivate: true, includePii: true },
    })
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
    const richIndex: AiwgFortemiIndexExport = {
      ...index,
      schema_version: 'aiwg.fortemi.index.export.v2',
      items: [
        {
          ...index.items[0],
          schema_version: 'aiwg.fortemi.index.record.v2',
          skos_concepts: [{ id: 'concept:rich', prefLabel: 'Rich Metadata' }],
          provenance_events: [{ activity: 'generated', agent: 'aiwg-index' }],
        },
        ...index.items.slice(1),
      ],
    }
    const built = buildAiwgChunkedIndex(richIndex, {
      partSize: 2,
      projection,
      privacy: { includePrivate: true, includePii: true },
    })
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
    expect(firstItem.skos_concepts).toBeUndefined()
    expect(firstItem.provenance_events).toBeUndefined()
    // every record has a full detail entry
    expect(built.details.length).toBe(richIndex.items.length)
    expect(built.details[0].record.provenance.length).toBeGreaterThan(0)
    expect(built.details[0].record.skos_concepts?.[0]?.prefLabel).toBe('Rich Metadata')
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

  it('traverses relationships and projects graphs from full and projected chunked indexes', async () => {
    const graphIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('aiwg:adr:001', 'aiwg.adr', 'ADR 001', 'Architecture decision.', {
          relationships: [{ type: 'satisfies', target_id: 'aiwg:requirement:001' }],
        }),
        record('aiwg:requirement:001', 'aiwg.requirement', 'Requirement 001', 'Search requirement.', {
          relationships: [{ type: 'cites', target_id: 'research:ref:001' }],
        }),
        record('research:ref:001', 'research.ref', 'REF 001', 'Research reference.'),
      ],
    }
    const controller = createAiwgIndexController(graphIndex)

    await expect(controller.relationshipQuery({ direction: 'out' })).rejects.toThrow(/requires sourceId/)
    await expect(controller.relationshipQuery({ direction: 'in' })).rejects.toThrow(/requires targetId/)
    const fullNeighbors = await controller.neighbors('aiwg:requirement:001', { direction: 'both' })
    expect(fullNeighbors.edges.map((edge) => edge.type).sort()).toEqual(['cites', 'satisfies'])

    const built = buildAiwgChunkedIndex(graphIndex, { partSize: 1, projection })
    const partsByHref = new Map(built.parts.map((entry) => [entry.href, entry.part]))
    const detailById = new Map(built.details.map((entry) => [entry.id, entry.record]))
    let detailFetches = 0
    const chunkedController = createAiwgIndexController()
    chunkedController.loadChunkedIndex(
      built.manifest,
      async (part) => partsByHref.get(part.href),
      {
        detailLoader: async (id) => {
          detailFetches += 1
          return detailById.get(id)
        },
      },
    )

    const chunkedNeighbors = await chunkedController.neighbors('aiwg:requirement:001', { direction: 'out', relationshipType: 'cites' })
    const relationshipSet = await chunkedController.relationshipSet({
      op: 'union',
      a: 'aiwg:adr:001',
      b: 'aiwg:requirement:001',
      direction: 'out',
    })
    const graph = await chunkedController.toCommunityGraphChunked()

    expect(chunkedNeighbors.edges).toEqual([{ source_id: 'aiwg:requirement:001', target_id: 'research:ref:001', type: 'cites' }])
    expect(relationshipSet.ids).toEqual(['aiwg:requirement:001', 'research:ref:001'])
    expect(graph.edges.map((edge) => edge.kind).sort()).toEqual(['cites', 'satisfies'])
    expect(detailFetches).toBeGreaterThan(0)
  })

  it('scopes both-direction neighbors before sorting and limiting', async () => {
    const graphIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('z:unrelated', 'aiwg.adr', 'Unrelated', 'No neighbor.', {
          relationships: [{ type: 'mentions', target_id: 'z:other' }],
        }),
        record('b:source', 'aiwg.adr', 'B Source', 'Neighbor B.', {
          relationships: [{ type: 'mentions', target_id: 'center' }],
        }),
        record('a:source', 'aiwg.adr', 'A Source', 'Neighbor A.', {
          relationships: [{ type: 'mentions', target_id: 'center' }],
        }),
        record('center', 'aiwg.requirement', 'Center', 'Target.'),
        record('z:other', 'aiwg.requirement', 'Other', 'Other target.'),
      ],
    }
    const controller = createAiwgIndexController(graphIndex)

    const result = await controller.neighbors('center', { direction: 'both', limit: 1 })

    expect(result.edges).toEqual([{ source_id: 'a:source', target_id: 'center', type: 'mentions' }])
    expect(result.nodes.map((node) => node.id).sort()).toEqual(['a:source', 'center'])
  })

  it('sorts relationship queries before applying limit', async () => {
    const graphIndex: AiwgFortemiIndexExport = {
      ...index,
      items: [
        record('b:source', 'aiwg.adr', 'B Source', 'B.', {
          relationships: [{ type: 'mentions', target_id: 'target' }],
        }),
        record('a:source', 'aiwg.adr', 'A Source', 'A.', {
          relationships: [{ type: 'mentions', target_id: 'target' }],
        }),
        record('target', 'aiwg.requirement', 'Target', 'Target.'),
      ],
    }
    const controller = createAiwgIndexController(graphIndex)

    const result = await controller.relationshipQuery({ limit: 1 })

    expect(result.edges).toEqual([{ source_id: 'a:source', target_id: 'target', type: 'mentions' }])
  })

  it('preserves v2 relationship direction and target paths across whole and chunked traversal', async () => {
    const graphIndex: AiwgFortemiIndexExport = {
      ...index,
      schema_version: 'aiwg.fortemi.index.export.v2',
      items: [
        v2Record('aiwg:command:deploy', 'aiwg.command', {
          search: { title: 'Deploy Command', body: 'Deployment command.' },
          relationships: [
            {
              type: 'depends-on',
              target_id: 'aiwg:skill:release',
              source_path: 'commands/deploy.md',
              target_path: 'skills/release/SKILL.md',
              direction: 'upstream',
            },
          ],
        }),
        v2Record('aiwg:kb:page:graph', 'aiwg.kb.page', {
          search: { title: 'Graph KB', body: 'KB graph page.' },
          relationships: [
            {
              type: 'references',
              target_id: 'aiwg:memory:entry:graph',
              source_path: 'kb/graph.md',
              target_path: 'memory/graph.md',
              direction: 'related',
            },
          ],
        }),
        v2Record('aiwg:memory:entry:graph', 'aiwg.memory.entry', {
          search: { title: 'Graph Memory', body: 'Memory graph entry.' },
        }),
        v2Record('aiwg:research:profile:alice', 'aiwg.research.profile', {
          search: { title: 'Alice Profile', body: 'Research profile.' },
          relationships: [
            {
              type: 'profiles',
              target_id: 'aiwg:research:ref:001',
              source_path: 'profiles/alice.md',
              target_path: 'refs/ref-001.md',
              direction: 'downstream',
            },
          ],
        }),
        v2Record('aiwg:research:ref:001', 'aiwg.research.ref', {
          search: { title: 'REF-001', body: 'Research reference.' },
          relationships: [
            {
              type: 'cites',
              target_id: 'aiwg:skill:release',
              source_path: 'refs/ref-001.md',
              target_path: 'skills/release/SKILL.md',
              direction: 'downstream',
            },
          ],
        }),
        v2Record('aiwg:skill:release', 'aiwg.skill', {
          search: { title: 'Release Skill', body: 'Release skill.' },
        }),
      ].sort((left, right) => left.id.localeCompare(right.id)),
    }
    const controller = createAiwgIndexController(graphIndex)

    const upstreamDeps = await controller.relationshipQuery({
      relationshipType: 'depends-on',
      relationshipDirection: 'upstream',
    })
    const profileNeighbors = await controller.neighbors('aiwg:research:profile:alice', {
      direction: 'out',
      relationshipType: 'profiles',
      relationshipDirection: 'downstream',
    })
    const kbNeighbors = await controller.neighbors('aiwg:kb:page:graph', {
      direction: 'out',
      relationshipType: 'references',
      relationshipDirection: 'related',
    })

    expect(upstreamDeps.edges).toEqual([
      {
        source_id: 'aiwg:command:deploy',
        target_id: 'aiwg:skill:release',
        type: 'depends-on',
        source_path: 'commands/deploy.md',
        target_path: 'skills/release/SKILL.md',
        direction: 'upstream',
      },
    ])
    expect(profileNeighbors.edges[0]).toMatchObject({
      source_id: 'aiwg:research:profile:alice',
      target_id: 'aiwg:research:ref:001',
      type: 'profiles',
      target_path: 'refs/ref-001.md',
      direction: 'downstream',
    })
    expect(kbNeighbors.nodes.map((node) => node.id).sort()).toEqual(['aiwg:kb:page:graph', 'aiwg:memory:entry:graph'])

    const built = buildAiwgChunkedIndex(graphIndex, { partSize: 2, projection: [...AIWG_SCAN_REQUIRED_FIELDS, 'relationships'] })
    const partsByHref = new Map(built.parts.map((entry) => [entry.href, entry.part]))
    const chunkedController = createAiwgIndexController()
    chunkedController.loadChunkedIndex(built.manifest, async (part) => partsByHref.get(part.href))

    const chunkedDeps = await chunkedController.relationshipQuery({
      relationshipType: 'depends-on',
      relationshipDirection: 'upstream',
    })
    const chunkedCitations = await chunkedController.relationshipQuery({
      relationshipType: 'cites',
      relationshipDirection: 'downstream',
    })

    expect(chunkedDeps.edges).toEqual(upstreamDeps.edges)
    expect(chunkedCitations.edges).toEqual([
      {
        source_id: 'aiwg:research:ref:001',
        target_id: 'aiwg:skill:release',
        type: 'cites',
        source_path: 'refs/ref-001.md',
        target_path: 'skills/release/SKILL.md',
        direction: 'downstream',
      },
    ])
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

describe('SEC2: fetch loader SSRF hardening (#241)', () => {
  it('resolves a relative href against a same-origin base', () => {
    expect(resolveAiwgFetchUrl('parts/0.json', 'https://host.example/idx/')).toBe(
      'https://host.example/idx/parts/0.json',
    )
  })

  it('rejects an absolute cross-origin href even with a base', () => {
    expect(() => resolveAiwgFetchUrl('https://evil.example/x.json', 'https://host.example/idx/')).toThrow(
      /cross-origin/i,
    )
  })

  it('rejects disallowed schemes', () => {
    expect(() => resolveAiwgFetchUrl('file:///etc/passwd', 'https://host.example/')).toThrow(/scheme/i)
    expect(() => resolveAiwgFetchUrl('file:///etc/passwd')).toThrow(/scheme/i)
  })

  it('passes through a bare relative href when no base is given', () => {
    expect(resolveAiwgFetchUrl('parts/0.json')).toBe('parts/0.json')
  })
})

describe('SEC5: duplicate-scan DoS cap (#241)', () => {
  const semanticIndex: AiwgFortemiIndexExport = {
    ...index,
    items: [
      record('a', 'aiwg.skill', 'A', 'a'),
      record('b', 'aiwg.skill', 'B', 'b'),
    ],
  }
  const embeddingSet: AiwgStaticEmbeddingSet = {
    schema_version: 'aiwg.fortemi.embedding.set.v1',
    id: 'cap-test',
    model: 'test-embed',
    dimensions: 3,
    generated_at: '2026-01-04T00:00:00.000Z',
    granularity: 'body',
    input_hash_algorithm: 'sha256',
    embeddings: [
      { record_id: 'a', embedding: [1, 0, 0], input_hash: 'ha' },
      { record_id: 'b', embedding: [0.99, 0.01, 0], input_hash: 'hb' },
    ],
  }

  it('throws when the embedding set exceeds the cap', () => {
    expect(() => findAiwgStaticDuplicatePairs(semanticIndex, embeddingSet, 0.9, { maxEmbeddings: 1 })).toThrow(
      /too large/i,
    )
  })

  it('scans normally within the cap', () => {
    const pairs = findAiwgStaticDuplicatePairs(semanticIndex, embeddingSet, 0.9, { maxEmbeddings: 10 })
    expect(pairs.map((p) => [p.left.id, p.right.id])).toEqual([['a', 'b']])
  })
})

describe('SEC1: prototype pollution via facet aggregation (#236)', () => {
  afterEach(() => {
    // Scrub any accidental pollution so a failure here cannot leak into other tests.
    for (const key of ['x', 'y', 'z', 'polluted']) {
      delete (Object.prototype as Record<string, unknown>)[key]
    }
  })

  // Object literals treat `__proto__:` as a prototype directive, so the only
  // faithful reproduction of the attack is JSON.parse — exactly how an untrusted
  // index is loaded from a URL or file.
  const maliciousFacets = () =>
    JSON.parse('{"__proto__":["x"],"constructor":["y"],"toString":["z"]}') as Record<string, string[]>

  it('does not pollute Object.prototype from getAiwgFortemiFacets', () => {
    const item = record('sec1', 'aiwg.skill', 'Malicious', 'body', { facets: maliciousFacets() })

    const facets = getAiwgFortemiFacets([item])

    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(({} as Record<string, unknown>).y).toBeUndefined()
    expect(({} as Record<string, unknown>).z).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'x')).toBe(false)
    // Built-ins remain intact (the `??=`/`+ 1` path previously corrupted toString).
    expect(typeof ({}).toString).toBe('function')
    // Exotic keys are still counted as plain data on the null-prototype accumulator.
    expect(facets['__proto__']).toEqual({ x: 1 })
    expect(facets.toString).toEqual({ z: 1 })
  })

  it('does not pollute Object.prototype through the public search path', () => {
    const item = record('sec1-search', 'aiwg.skill', 'Malicious', 'body', { facets: maliciousFacets() })
    const maliciousIndex = { ...index, items: [item] } as AiwgFortemiIndexExport

    const result = queryAiwgFortemiIndex(maliciousIndex)

    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(({} as Record<string, unknown>).z).toBeUndefined()
    expect(result.facets['__proto__']).toEqual({ x: 1 })
  })

  it.each(['constructor', '__proto__', 'toString'])('counts exotic record type %s as plain data', (type) => {
    const result = validateAiwgFortemiIndexExport({
      ...index,
      items: [record('sec1-type', type, 'Exotic type', 'body')],
    })

    expect(result.counts[type]).toBe(1)
    expect(typeof result.counts[type]).toBe('number')
  })

  it.each(['constructor', '__proto__', 'toString'])('keeps graph weights numeric for relationship type %s', (type) => {
    const source = record('a', 'aiwg.skill', 'A', 'body', {
      relationships: [
        { type, target_id: 'b' },
        { type, target_id: 'b' },
      ],
    })
    const target = record('b', 'aiwg.skill', 'B', 'body')
    const graph = aiwgFortemiIndexToCommunityGraph(
      { ...index, items: [source, target] },
      { relationshipWeights: JSON.parse(`{"${type}":2}`) as Record<string, number> },
    )

    expect(graph.edges).toEqual([{ source: 'a', target: 'b', kind: type, weight: 4 }])
    expect(Number.isFinite(graph.edges[0]?.weight)).toBe(true)
  })

  it('defaults inherited and non-finite relationship weights to a finite number', () => {
    const source = record('a', 'aiwg.skill', 'A', 'body', {
      relationships: [{ type: 'constructor', target_id: 'b' }, { type: 'bad', target_id: 'b' }],
    })
    const graph = aiwgFortemiIndexToCommunityGraph(
      { ...index, items: [source, record('b', 'aiwg.skill', 'B', 'body')] },
      { relationshipWeights: { bad: Number.NaN } },
    )

    expect(graph.edges.map((edge) => edge.weight)).toEqual([1, 1])
    expect(graph.edges.every((edge) => Number.isFinite(edge.weight))).toBe(true)
  })
})

describe('SEC6: privacy/PII filtered at generation (#243)', () => {
  const backend = {
    model: 'test-embed',
    dimensions: 3,
    embed: () => [1, 0, 0],
  }
  // Items must be sorted by id for a valid export (pii < prv < pub).
  const mixed: AiwgFortemiIndexExport = {
    ...index,
    items: [
      record('pii', 'aiwg.skill', 'Pii', 'ssn body', { privacy: { classification: 'public', pii: true } }),
      record('prv', 'aiwg.skill', 'Private', 'secret body', { privacy: { classification: 'private', pii: false } }),
      record('pub', 'aiwg.skill', 'Public', 'public body', { privacy: { classification: 'public', pii: false } }),
    ],
  }

  it('filterAiwgRecordsByPrivacy drops private/pii by default and honors opt-in', () => {
    expect(filterAiwgRecordsByPrivacy(mixed.items).map((r) => r.id)).toEqual(['pub'])
    expect(filterAiwgRecordsByPrivacy(mixed.items, { includePrivate: true }).map((r) => r.id).sort()).toEqual(['prv', 'pub'])
    expect(filterAiwgRecordsByPrivacy(mixed.items, { includePii: true }).map((r) => r.id).sort()).toEqual(['pii', 'pub'])
    expect(
      filterAiwgRecordsByPrivacy(mixed.items, { includePrivate: true, includePii: true }).map((r) => r.id).sort(),
    ).toEqual(['pii', 'prv', 'pub'])
  })

  it('fails closed for missing or unknown privacy metadata', () => {
    const missing = { ...record('missing', 'aiwg.skill', 'Missing', 'body'), privacy: undefined } as unknown as AiwgFortemiRecord
    const unknown = { ...record('unknown', 'aiwg.skill', 'Unknown', 'body'), privacy: { classification: 'confidential', pii: false } } as unknown as AiwgFortemiRecord
    expect(filterAiwgRecordsByPrivacy([missing, unknown], { includePrivate: true, includePii: true })).toEqual([])
    expect(() => buildAiwgChunkedIndex({ ...index, items: [missing] })).toThrow(/privacy/)
  })

  it('buildAiwgStaticEmbeddingSet excludes private/pii by default', async () => {
    const safe = await buildAiwgStaticEmbeddingSet(mixed, { id: 'safe', backend })
    expect(safe.embeddings.map((e) => e.record_id)).toEqual(['pub'])

    const full = await buildAiwgStaticEmbeddingSet(mixed, {
      id: 'full',
      backend,
      privacy: { includePrivate: true, includePii: true },
    })
    expect(full.embeddings.map((e) => e.record_id).sort()).toEqual(['pii', 'prv', 'pub'])
  })

  it('buildAiwgChunkedIndex excludes private/pii from parts and facet counts by default', () => {
    const built = buildAiwgChunkedIndex(mixed, { partSize: 10 })
    const ids = built.parts.flatMap((p) => p.part.items.map((i) => i.id))
    expect(ids).toEqual(['pub'])
    expect(built.manifest.total).toBe(1)

    const full = buildAiwgChunkedIndex(mixed, { partSize: 10, privacy: { includePrivate: true, includePii: true } })
    expect(full.manifest.total).toBe(3)
  })
})

describe('#239 validator conformance — v1/v2 forbiddance, enums, source gating, review-decision version', () => {
  const exportV1 = (items: AiwgFortemiRecord[]): unknown => ({ ...index, schema_version: 'aiwg.fortemi.index.export.v1', items })

  it('accepts bytewise-sorted mixed-case ids independent of locale', () => {
    const result = validateAiwgFortemiIndexExport(exportV1([
      record('Zeta', 'aiwg.skill', 'Zeta', 'body'),
      record('alpha', 'aiwg.skill', 'Alpha', 'body'),
    ]))
    expect(result.errors.filter((error) => error.includes('sorted by id'))).toEqual([])
  })

  it('A2 — rejects a record.v1 carrying record-level v2-only fields', () => {
    const cases: Array<[string, Partial<AiwgFortemiRecord>]> = [
      ['search', { search: { title: 'x' } }],
      ['chunks', { chunks: [] }],
      ['embeddings', { embeddings: [] }],
      ['skos_concepts', { skos_concepts: [] }],
      ['skos_relations', { skos_relations: [] }],
      ['compatibility', { compatibility: {} }],
    ]
    for (const [field, extra] of cases) {
      const res = validateAiwgFortemiIndexExport(exportV1([record('r', 'aiwg.skill', 'R', 'body', extra)]))
      expect(res.valid, field).toBe(false)
      expect(res.errors.join('\n'), field).toContain('.' + field + ' is a v2-only field')
    }
  })

  it('A2 — rejects a record.v1 carrying nested v2-only fields (source, privacy.locality, relationship)', () => {
    const withSource = record('r', 'aiwg.skill', 'R', 'body', {
      source: { path: 'r.md', repo_relative_path: 'r.md', locator: 'r', origin: 'aiwg' },
    })
    expect(validateAiwgFortemiIndexExport(exportV1([withSource])).errors.join('\n')).toContain('.source.origin is a v2-only field')

    const withLocality = record('r', 'aiwg.skill', 'R', 'body', { privacy: { classification: 'public', pii: false, locality: 'workspace' } })
    expect(validateAiwgFortemiIndexExport(exportV1([withLocality])).errors.join('\n')).toContain('.privacy.locality is a v2-only field')

    const withRel = record('r', 'aiwg.skill', 'R', 'body', { relationships: [{ type: 'documents', target_id: 't', direction: 'upstream' }] })
    expect(validateAiwgFortemiIndexExport(exportV1([withRel])).errors.join('\n')).toContain('.relationships[0].direction is a v2-only field')
  })

  it('A2 — a record.v2 carrying the same fields is accepted', () => {
    const v2 = v2Record('aiwg:agent:planner', 'aiwg.agent', {
      search: { title: 'Planner' },
      chunks: [],
      skos_concepts: [{ id: 'c', prefLabel: 'C' }],
      relationships: [{ type: 'documents', target_id: 't', direction: 'upstream' }],
      source: { path: 'p.md', repo_relative_path: 'p.md', locator: 'p', origin: 'aiwg', generated: true },
    })
    const res = validateAiwgFortemiIndexExport({ ...index, schema_version: 'aiwg.fortemi.index.export.v2', items: [v2] })
    expect(res.errors).toEqual([])
    expect(res.valid).toBe(true)
  })

  it('A4 — rejects invalid privacy.classification and provenance shape/enum', () => {
    const badClass = record('r', 'aiwg.skill', 'R', 'body', { privacy: { classification: 'secret' as unknown as 'public', pii: false } })
    expect(validateAiwgFortemiIndexExport(exportV1([badClass])).errors.join('\n')).toContain('privacy.classification must be one of')

    const badConf = record('r', 'aiwg.skill', 'R', 'body', {
      provenance: [{ field: 'text', source: 'r.md', path: '$.text', confidence: 'bogus' as unknown as 'source', privacy: 'public' }],
    })
    expect(validateAiwgFortemiIndexExport(exportV1([badConf])).errors.join('\n')).toContain('provenance[0].confidence must be one of')

    const missingField = record('r', 'aiwg.skill', 'R', 'body', {
      provenance: [{ source: 'r.md', path: '$.text', confidence: 'source', privacy: 'public' } as unknown as AiwgFortemiRecord['provenance'][number]],
    })
    expect(validateAiwgFortemiIndexExport(exportV1([missingField])).errors.join('\n')).toContain('provenance[0].field is required')
  })

  it('A5 — source.graph and compatibility are gated to export.v2', () => {
    const rec = record('r', 'aiwg.skill', 'R', 'body')
    const v1Graph = { ...index, schema_version: 'aiwg.fortemi.index.export.v1', source: { repo: 'x/y', privacy: 'public', graph: {} }, items: [rec] }
    expect(validateAiwgFortemiIndexExport(v1Graph).errors.join('\n')).toContain('source.graph is a v2-only field')
    const v1Compat = { ...index, schema_version: 'aiwg.fortemi.index.export.v1', compatibility: {}, items: [rec] }
    expect(validateAiwgFortemiIndexExport(v1Compat).errors.join('\n')).toContain('compatibility is a v2-only field')
    const v2Ok = { ...index, schema_version: 'aiwg.fortemi.index.export.v2', source: { repo: 'x/y', privacy: 'public', graph: { communities: 1 } }, compatibility: {}, items: [v2Record('r', 'aiwg.skill')] }
    expect(validateAiwgFortemiIndexExport(v2Ok).valid).toBe(true)
  })

  it('E8 — chunked v2 source metadata survives validation, querying, and record loading', async () => {
    const v2Index: AiwgFortemiIndexExport = {
      ...index,
      schema_version: 'aiwg.fortemi.index.export.v2',
      source: { repo: 'x/y', privacy: 'public', graph: { communities: 1 } },
      items: [v2Record('r', 'aiwg.skill')],
    }
    const built = buildAiwgChunkedIndex(v2Index)
    expect(built.manifest.source_export_schema_version).toBe('aiwg.fortemi.index.export.v2')
    expect(validateAiwgFortemiChunkManifest(built.manifest).valid).toBe(true)

    const parts = new Map(built.parts.map(({ href, part }) => [href, part]))
    const controller = createAiwgIndexController()
    controller.loadChunkedIndex(built.manifest, async (part) => parts.get(part.href))
    await expect(controller.queryChunked('')).resolves.toMatchObject({ total: 1 })
    await expect(controller.getRecord('r')).resolves.toMatchObject({ id: 'r' })

    const exported = createAiwgReviewDecisionExport(
      { schema_version: built.manifest.source_export_schema_version ?? 'aiwg.fortemi.index.export.v1' },
      [],
    )
    expect(exported.source_export_schema_version).toBe('aiwg.fortemi.index.export.v2')
  })
})

describe('public validators reject hostile shapes without throwing (#288)', () => {
  it.each([
    ['non-array items', { ...index, items: {} }],
    ['null item', { ...index, items: [null] }],
    ['null chunk', { ...index, items: [{ ...index.items[0], chunks: [null] }] }],
    ['null compatibility', { ...index, compatibility: null }],
  ])('%s', (_name, value) => {
    expect(() => validateAiwgFortemiIndexExport(value)).not.toThrow()
    expect(validateAiwgFortemiIndexExport(value).valid).toBe(false)
  })

  it('rejects null manifest detail and part entries without throwing', () => {
    const manifest = buildAiwgChunkedIndex(index).manifest
    for (const value of [{ ...manifest, detail: null }, { ...manifest, parts: [null] }]) {
      expect(() => validateAiwgFortemiChunkManifest(value)).not.toThrow()
      expect(validateAiwgFortemiChunkManifest(value).valid).toBe(false)
    }
  })

  it('rejects null projected records and static embeddings without throwing', () => {
    const built = buildAiwgChunkedIndex(index, { projection: AIWG_SCAN_REQUIRED_FIELDS })
    const projectedPart = { ...built.parts[0].part, items: [null] }
    expect(() => validateAiwgFortemiChunkPart(projectedPart, built.manifest.parts[0], built.manifest)).not.toThrow()
    expect(validateAiwgFortemiChunkPart(projectedPart, built.manifest.parts[0], built.manifest).valid).toBe(false)

    const embeddingSet = { schema_version: 'aiwg.fortemi.embedding.set.v1', id: 'x', model: 'x', dimensions: 1, generated_at: new Date().toISOString(), granularity: 'record', embeddings: [null] }
    expect(() => validateAiwgStaticEmbeddingSet(embeddingSet)).not.toThrow()
    expect(validateAiwgStaticEmbeddingSet(embeddingSet).valid).toBe(false)
  })
})
