import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DATASET_LINEAGE_CONTRACT } from '@fortemi/core'
import {
  DatasetConnectorForm,
  DatasetLineageView,
  DatasetPlanReview,
  DatasetRejectionsView,
  DatasetRunView,
  DatasetStatusView,
} from '../components.js'
import { datasetConnectorFixtureSchema, datasetStatusStoryFixtures, datasetTerminalRunStories } from '../fixtures.js'

const plan = { id: 'plan-42', digest: 'sha256:plan', sourceRevision: 'rev-1', sourceDigest: 'sha256:source', configurationDigest: 'sha256:config', capabilities: ['index.lexical'], transforms: [], locality: 'browser', outboundHosts: [], privacy: 'restricted', rights: 'approved', retention: '30d', estimatedWrites: 1, fallbackBehavior: 'fail closed', reconciliation: { destructive: true, estimatedDeletes: 2, confirmationThreshold: 1 } }

describe('dataset components', () => {
  it('renders constrained write-only connector fields without their value', () => {
    const html = renderToStaticMarkup(<DatasetConnectorForm schema={datasetConnectorFixtureSchema} configuration={{ mode: 'remote', endpoint: 'https://example.test', credentialReference: 'synthetic-secret-ref' }} validation={{}} onChange={() => undefined} />)
    expect(html).toContain('type="password"')
    expect(html).toContain('autoComplete="off"')
    expect(html).toContain('aria-describedby')
    expect(html).not.toContain('synthetic-secret-ref')
  })

  it('requires a typed destructive confirmation and names reviewed impact', () => {
    const html = renderToStaticMarkup(<DatasetPlanReview plan={plan} confirmation="" onConfirmation={() => undefined} onApprove={() => undefined} />)
    expect(html).toContain('2 estimated deletions')
    expect(html).toContain('Type <strong>plan-42</strong>')
    expect(html).toContain('disabled=""')
  })

  it('does not fabricate progress when total work is unknown', () => {
    const html = renderToStaticMarkup(<DatasetRunView run={{ ...datasetTerminalRunStories.cancelled, lifecycle: 'running', total: undefined }} onCancel={() => undefined} onRetry={() => undefined} />)
    expect(html).toContain('total work is unknown')
    expect(html).not.toContain('<progress')
    expect(html).toContain('Cancel run')
  })

  it('renders distinct plane, maturity, availability, and data-state labels for every story fixture', () => {
    const snapshots = Object.entries(datasetStatusStoryFixtures).map(([name, status]) => [name, renderToStaticMarkup(<DatasetStatusView status={status} />)])
    expect(new Set(snapshots.map(([, html]) => html)).size).toBe(snapshots.length)
    for (const [, html] of snapshots) {
      expect(html).toContain('Execution plane:')
      expect(html).toContain('maturity:')
    }
  })

  it('renders rejection locator, digest, stable code, and reason only', () => {
    const html = renderToStaticMarkup(<DatasetRejectionsView rejections={[{ locator: 'row:2', logicalIdDigest: 'sha256:id', code: 'INVALID', reason: 'Schema mismatch' }]} />)
    expect(html).toContain('row:2'); expect(html).toContain('sha256:id'); expect(html).toContain('INVALID'); expect(html).toContain('Schema mismatch')
  })

  it('labels lineage assertions as claims with evidence and bounded pagination', () => {
    const html = renderToStaticMarkup(<DatasetLineageView result={{
      contract: DATASET_LINEAGE_CONTRACT, schemaVersion: '1.0.0', snapshot: 4, truncated: true, nextCursor: 'opaque',
      nodes: [{ entity: { id: 'record:1', kind: 'record', schemaId: 'record', schemaVersion: '1', createdAt: '2026-01-01T00:00:00Z' }, depth: 0, pathAssertionIds: [] }],
      edges: [{ assertion: { id: 'assertion:1', revision: '1', relationship: 'derived-from', assertionKind: 'observed', sourceEntityId: 'record:1', targetEntityId: 'dataset:1', issuerAgentId: 'agent:1', producingActivityId: 'run:1', method: 'digest-match', evidence: [{ evidenceId: 'e:1', revision: '1', digest: 'sha256:e' }], confidence: .9, privacy: 'restricted', schemaId: 'lineage', schemaVersion: '1', assertedAt: '2026-01-01T00:00:00Z' }, status: 'active', evidence: [{ id: 'e:1', revision: '1', locator: 'evidence://redacted', digest: 'sha256:e', privacy: 'restricted', capturedAt: '2026-01-01T00:00:00Z' }] }],
    }} />)
    expect(html).toContain('Adjacency is not proof')
    expect(html).toContain('observed')
    expect(html).toContain('0.9')
    expect(html).toContain('More results are available')
  })

  it('preserves cyclic lineage ordering while bounding the visible window and withholding unreadable evidence', () => {
    const entity = (id: string) => ({ id, kind: 'record' as const, schemaId: 'record', schemaVersion: '1', createdAt: '2026-01-01T00:00:00Z' })
    const assertion = (id: string, sourceEntityId: string, targetEntityId: string) => ({ id, revision: '1', relationship: 'derived-from' as const, assertionKind: 'declared' as const, sourceEntityId, targetEntityId, issuerAgentId: 'agent:1', method: 'operator-declaration', evidence: [], confidence: .5, privacy: 'restricted' as const, schemaId: 'lineage', schemaVersion: '1', assertedAt: '2026-01-01T00:00:00Z' })
    const html = renderToStaticMarkup(<DatasetLineageView maximumVisibleNodes={1} maximumVisibleEdges={1} result={{ contract: DATASET_LINEAGE_CONTRACT, schemaVersion: '1.0.0', snapshot: 5, truncated: false, nodes: [{ entity: entity('a'), depth: 0, pathAssertionIds: [] }, { entity: entity('b'), depth: 1, pathAssertionIds: ['ab'] }], edges: [{ assertion: assertion('ab', 'a', 'b'), status: 'active' }, { assertion: assertion('ba', 'b', 'a'), status: 'active' }] }} />)
    expect(html).toContain('record: a'); expect(html).not.toContain('record: b')
    expect(html).toContain('a → b'); expect(html).not.toContain('b → a')
    expect(html).toContain('declared'); expect(html).toContain('No readable evidence'); expect(html).toContain('next visible window')
  })

  it('uses semantic landmarks, labels, live regions, and text alongside state styling', () => {
    const run = renderToStaticMarkup(<DatasetRunView run={datasetTerminalRunStories.failed} onCancel={() => undefined} onRetry={() => undefined} />)
    const form = renderToStaticMarkup(<DatasetConnectorForm schema={datasetConnectorFixtureSchema} configuration={{ mode: 'local', endpoint: '' }} validation={{ endpoint: 'Endpoint is required' }} onChange={() => undefined} />)
    expect(run).toContain('aria-live="polite"'); expect(run).toContain('Retry run')
    expect(form).toContain('<fieldset>'); expect(form).toContain('<legend>'); expect(form).toContain('aria-invalid="true"')
  })
})
