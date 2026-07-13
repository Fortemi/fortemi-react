// A hand-authored AIWG artifact index — the same shape `aiwg index export`
// produces for a real AIWG-managed repo, trimmed to a legible dozen records.
// Records carry no `concepts`, so `toCommunityGraph()` falls back to grouping by
// `type` — the graph's communities become the artifact kinds (agent, command,
// rule, skill, doc). Relationships whose target is in-set become the edges.

import type {
  AiwgFortemiIndexExport,
  AiwgFortemiRecord,
  AiwgFortemiRelationship,
} from '@fortemi/core/aiwg-index'

const UPDATED = '2026-07-01T00:00:00.000Z'

function rec(
  id: string,
  type: string,
  title: string,
  opts: {
    text?: string
    tags?: string[]
    rels?: AiwgFortemiRelationship[]
  } = {},
): AiwgFortemiRecord {
  const path = `.aiwg/${type}s/${id}.md`
  return {
    schema_version: 'aiwg.fortemi.index.record.v1',
    id,
    type,
    source: { path, repo_relative_path: path, locator: `${path}#L1` },
    title,
    text: opts.text ?? title,
    facets: { type: [type] },
    tags: opts.tags ?? [],
    concepts: [],
    relationships: opts.rels ?? [],
    provenance: [],
    privacy: { classification: 'public', pii: false },
    updated_at: UPDATED,
  }
}

const rel = (type: string, target_id: string, label?: string): AiwgFortemiRelationship => ({
  type,
  target_id,
  ...(label ? { label } : {}),
})

const items: AiwgFortemiRecord[] = [
  // Agents
  rec('agent-architecture-designer', 'agent', 'Architecture Designer', {
    tags: ['design', 'sdlc'],
    rels: [rel('documents', 'doc-sdlc-guide')],
  }),
  rec('agent-security-auditor', 'agent', 'Security Auditor', {
    tags: ['security', 'review'],
    rels: [rel('enforces', 'rule-token-security'), rel('enforces', 'rule-human-authorization')],
  }),
  rec('agent-test-engineer', 'agent', 'Test Engineer', {
    tags: ['testing', 'sdlc'],
    rels: [rel('governed-by', 'rule-anti-laziness')],
  }),

  // Commands
  rec('cmd-flow-inception', 'command', 'flow-inception-to-elaboration', {
    tags: ['sdlc', 'flow'],
    rels: [rel('uses', 'agent-architecture-designer'), rel('documents', 'doc-sdlc-guide')],
  }),
  rec('cmd-address-issues', 'command', 'address-issues', {
    tags: ['workflow', 'issues'],
    rels: [rel('uses', 'agent-test-engineer')],
  }),
  rec('cmd-code-review', 'command', 'code-review', {
    tags: ['review', 'quality'],
    rels: [rel('uses', 'agent-security-auditor'), rel('governed-by', 'rule-anti-laziness')],
  }),

  // Rules
  rec('rule-anti-laziness', 'rule', 'anti-laziness', { tags: ['quality', 'sdlc'] }),
  rec('rule-token-security', 'rule', 'token-security', { tags: ['security'] }),
  rec('rule-human-authorization', 'rule', 'human-authorization', {
    tags: ['security', 'safety'],
    rels: [rel('related', 'rule-token-security')],
  }),

  // Skills
  rec('skill-intake-wizard', 'skill', 'intake-wizard', {
    tags: ['sdlc', 'intake'],
    rels: [rel('invoked-by', 'cmd-flow-inception')],
  }),
  rec('skill-doc-sync', 'skill', 'doc-sync', {
    tags: ['docs'],
    rels: [rel('documents', 'doc-sdlc-guide')],
  }),

  // Docs
  rec('doc-sdlc-guide', 'doc', 'SDLC Complete Guide', { tags: ['sdlc', 'docs'] }),
]

export const sampleIndex: AiwgFortemiIndexExport = {
  schema_version: 'aiwg.fortemi.index.export.v1',
  generated_at: UPDATED,
  source: { repo: 'example/aiwg-managed-project', privacy: 'public' },
  items,
}
