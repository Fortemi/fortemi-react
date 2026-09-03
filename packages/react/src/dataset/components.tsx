import type { ChangeEvent, ReactNode } from 'react'
import type { LineageTraversalResult } from '@fortemi/core'
import { isSecretProperty, visibleDatasetConfigFields } from './machine.js'
import type {
  DatasetCheckResult,
  DatasetConfigProperty,
  DatasetConfigSchema,
  DatasetDiagnostic,
  DatasetFreshnessStatus,
  DatasetJsonPrimitive,
  DatasetPlan,
  DatasetPreview,
  DatasetRejection,
  DatasetRunProgress,
  DatasetWorkflowSnapshot,
} from './types.js'

const visuallyHidden = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 } as const

function Badge({ children }: { children: ReactNode }) {
  return <span style={{ display: 'inline-block', border: '1px solid currentColor', borderRadius: '.25rem', padding: '.125rem .375rem', marginInlineEnd: '.375rem', fontWeight: 700 }}>{children}</span>
}

export function DatasetDiagnosticView({ diagnostic }: { diagnostic: DatasetDiagnostic }) {
  return <section role={diagnostic.severity === 'error' ? 'alert' : 'status'} aria-labelledby={`diagnostic-${diagnostic.code}`}>
    <h4 id={`diagnostic-${diagnostic.code}`}>{diagnostic.summary}</h4>
    <p><Badge>{diagnostic.severity}</Badge><code>{diagnostic.code}</code> · Retry: {diagnostic.retryClass}</p>
    {diagnostic.remediation && <p>{diagnostic.remediation}</p>}
  </section>
}

function inputType(property: DatasetConfigProperty): string {
  if (property.type === 'boolean') return 'checkbox'
  if (property.type === 'integer' || property.type === 'number') return 'number'
  if (isSecretProperty(property)) return 'password'
  if (property.format === 'uri') return 'url'
  return 'text'
}

export interface DatasetConnectorFormProps {
  schema: DatasetConfigSchema
  configuration: Readonly<Record<string, DatasetJsonPrimitive>>
  validation: Readonly<Record<string, string>>
  onChange(key: string, value: DatasetJsonPrimitive): void
}

export function DatasetConnectorForm({ schema, configuration, validation, onChange }: DatasetConnectorFormProps) {
  return <fieldset>
    <legend>{schema.title ?? 'Dataset connection'}</legend>
    {schema.description && <p>{schema.description}</p>}
    <p id="credential-guidance">Credential inputs are write-only. Saved values are never displayed again.</p>
    {visibleDatasetConfigFields(schema, configuration).map(key => {
      const property = schema.properties[key]!
      const id = `dataset-config-${key}`
      const describedBy = `${id}-description${validation[key] ? ` ${id}-error` : ''}${isSecretProperty(property) ? ' credential-guidance' : ''}`
      if (property.enum) return <div key={key} style={{ marginBlock: '1rem' }}>
        <label htmlFor={id}>{property.title ?? key}</label>
        <select id={id} value={String(configuration[key] ?? '')} aria-describedby={describedBy} aria-invalid={Boolean(validation[key])} onChange={event => onChange(key, event.target.value)}>
          <option value="">Choose…</option>{property.enum.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
        </select>
        <small id={`${id}-description`}>{property.description}</small>{validation[key] && <strong id={`${id}-error`}>{validation[key]}</strong>}
      </div>
      const type = inputType(property)
      const value = isSecretProperty(property) ? '' : configuration[key]
      return <div key={key} style={{ marginBlock: '1rem', display: 'grid', gap: '.25rem' }}>
        <label htmlFor={id}>{property.title ?? key}</label>
        <input id={id} type={type} checked={type === 'checkbox' ? Boolean(value) : undefined}
          value={type === 'checkbox' || isSecretProperty(property) ? undefined : String(value ?? '')} defaultValue={isSecretProperty(property) ? '' : undefined}
          min={property.minimum} max={property.maximum} minLength={property.minLength} maxLength={property.maxLength} pattern={property.pattern}
          autoComplete={isSecretProperty(property) ? 'off' : undefined} aria-describedby={describedBy} aria-invalid={Boolean(validation[key])}
          onChange={isSecretProperty(property) ? undefined : (event: ChangeEvent<HTMLInputElement>) => onChange(key, type === 'checkbox' ? event.target.checked : type === 'number' ? Number(event.target.value) : event.target.value)}
          onBlur={isSecretProperty(property) ? event => { onChange(key, event.currentTarget.value); event.currentTarget.value = '' } : undefined} />
        <small id={`${id}-description`}>{property.description}</small>{validation[key] && <strong id={`${id}-error`}>{validation[key]}</strong>}
      </div>
    })}
  </fieldset>
}

export function DatasetCheckView({ results }: { results: readonly DatasetCheckResult[] }) {
  return <section aria-labelledby="dataset-check-heading"><h3 id="dataset-check-heading">Connection check</h3><ol>{results.map(result => <li key={result.stage}>
    <Badge>{result.status}</Badge><strong>{result.stage}</strong>
    {result.diagnostics.map(item => <DatasetDiagnosticView key={item.code} diagnostic={item} />)}
  </li>)}</ol></section>
}

export function DatasetPreviewView({ preview }: { preview: DatasetPreview }) {
  return <section aria-labelledby="dataset-preview-heading"><h3 id="dataset-preview-heading">Bounded, side-effect-free preview</h3>
    <p>Up to {preview.limit} records · {preview.estimate.records ?? 'unknown'} records · {preview.estimate.bytes ?? 'unknown'} bytes · {preview.estimate.networkBytes ?? 'unknown'} network bytes · {preview.estimate.storageBytes ?? 'unknown'} storage bytes</p>
    {preview.unsupportedCapabilities.length > 0 && <p><Badge>unsupported</Badge>{preview.unsupportedCapabilities.join(', ')}</p>}
    {preview.datasets.map(dataset => <article key={dataset.id}><h4>{dataset.id}</h4><p>Inferred schema: {dataset.inferredSchema}</p>
      <ul>{dataset.streams.map(stream => <li key={stream.id}>{stream.id}: {stream.fields.join(', ')}</li>)}</ul>
      <details><summary>Redacted samples</summary><pre>{JSON.stringify(dataset.redactedSamples, null, 2)}</pre></details></article>)}
  </section>
}

export function DatasetPlanReview({ plan, confirmation, onConfirmation, onApprove }: { plan: DatasetPlan; confirmation: string; onConfirmation(value: string): void; onApprove(): void }) {
  const requiresConfirmation = plan.reconciliation.destructive && plan.reconciliation.estimatedDeletes >= plan.reconciliation.confirmationThreshold
  return <section aria-labelledby="dataset-plan-heading"><h3 id="dataset-plan-heading">Immutable plan review</h3>
    <dl><dt>Plan</dt><dd>{plan.id}</dd><dt>Plan digest</dt><dd><code>{plan.digest}</code></dd><dt>Source revision / digest</dt><dd>{plan.sourceRevision} / <code>{plan.sourceDigest}</code></dd>
      <dt>Configuration digest</dt><dd><code>{plan.configurationDigest}</code></dd><dt>Capabilities</dt><dd>{plan.capabilities.join(', ')}</dd><dt>Transforms</dt><dd>{plan.transforms.join(', ') || 'None'}</dd>
      <dt>Locality</dt><dd>{plan.locality}</dd><dt>Outbound hosts</dt><dd>{plan.outboundHosts.join(', ') || 'None'}</dd><dt>Privacy / rights / retention</dt><dd>{plan.privacy} / {plan.rights} / {plan.retention}</dd>
      <dt>Estimated writes / cost</dt><dd>{plan.estimatedWrites} / {plan.estimatedCost ?? 'unknown'}</dd><dt>Fallback behavior</dt><dd>{plan.fallbackBehavior}</dd><dt>Destructive impact</dt><dd>{plan.reconciliation.destructive ? `${plan.reconciliation.estimatedDeletes} estimated deletions` : 'None'}</dd></dl>
    {requiresConfirmation && <label>Type <strong>{plan.id}</strong> to confirm reviewed destructive impact<input value={confirmation} onChange={event => onConfirmation(event.target.value)} /></label>}
    <button type="button" disabled={requiresConfirmation && confirmation !== plan.id} onClick={onApprove}>Verify digest and approve plan</button>
  </section>
}

export function DatasetRunView({ run, onCancel, onRetry }: { run: DatasetRunProgress; onCancel(): void; onRetry(): void }) {
  const determinate = run.total !== undefined
  return <section aria-live="polite" aria-labelledby="dataset-run-heading"><h3 id="dataset-run-heading">Run {run.runId}</h3>
    <p><Badge>{run.lifecycle}</Badge>Stage: {run.stage} · Verification: {run.verification}</p>
    {determinate ? <progress value={run.observed} max={run.total} aria-label={`${run.observed} of ${run.total} observed`} /> : <p role="status">{run.observed} records observed; total work is unknown.</p>}
    <p>Accepted {run.accepted}; rejected {run.rejected}; checkpoint {run.lastCheckpoint ?? 'none'}.</p>
    {run.diagnostics.map(item => <DatasetDiagnosticView key={item.code} diagnostic={item} />)}
    {['queued', 'running'].includes(run.lifecycle) && <button type="button" onClick={onCancel}>Cancel run</button>}
    {['cancelled', 'failed', 'degraded'].includes(run.lifecycle) && run.retryClass !== 'never' && <button type="button" onClick={onRetry}>Retry run</button>}
  </section>
}

export function DatasetStatusView({ status }: { status: DatasetFreshnessStatus }) {
  const runtime = status.capabilityDescriptor.runtime
  return <section aria-labelledby="dataset-status-heading"><h3 id="dataset-status-heading">Dataset status</h3>
    <p><Badge>{status.artifactState}</Badge><Badge>{status.availability}</Badge><Badge>{status.freshness}</Badge></p>
    <p>Execution plane: <strong>{runtime.plane}</strong>; data class: <strong>{runtime.dataClass}</strong>; maturity: <strong>{runtime.maturity}</strong>.</p>
    {status.cacheAgeSeconds !== undefined && <p>Cache age: {status.cacheAgeSeconds} seconds.</p>}
    {status.changedGuarantees?.length ? <p>Changed guarantees: {status.changedGuarantees.join('; ')}</p> : null}
    <dl><dt>Last attempt</dt><dd>{status.lastAttempt ? `${status.lastAttempt.runId}: ${status.lastAttempt.state}` : 'Never'}</dd><dt>Last successful run</dt><dd>{status.lastSuccessful ? `${status.lastSuccessful.runId}: ${status.lastSuccessful.state}` : 'Never'}</dd></dl>
  </section>
}

export function DatasetRejectionsView({ rejections }: { rejections: readonly DatasetRejection[] }) {
  return <section aria-labelledby="dataset-rejections-heading"><h3 id="dataset-rejections-heading">Rejections</h3><table><thead><tr><th>Locator</th><th>Digest</th><th>Code</th><th>Reason</th></tr></thead><tbody>
    {rejections.map(item => <tr key={`${item.logicalIdDigest}:${item.code}`}><td>{item.locator ?? 'withheld'}</td><td><code>{item.logicalIdDigest}</code></td><td><code>{item.code}</code></td><td>{item.reason}</td></tr>)}
  </tbody></table></section>
}

export function DatasetLineageView({ result, maximumVisibleNodes = 200, maximumVisibleEdges = 200 }: { result: LineageTraversalResult; maximumVisibleNodes?: number; maximumVisibleEdges?: number }) {
  const nodes = result.nodes.slice(0, Math.max(1, maximumVisibleNodes))
  const edges = result.edges.slice(0, Math.max(1, maximumVisibleEdges))
  const windowed = nodes.length < result.nodes.length || edges.length < result.edges.length
  return <section aria-labelledby="dataset-lineage-heading"><h3 id="dataset-lineage-heading">Evidence-aware lineage</h3>
    <p><Badge>{result.truncated || windowed ? 'bounded result—more available' : 'complete bounded result'}</Badge>Snapshot {result.snapshot}. Adjacency is not proof; inspect assertion and evidence.</p>
    <ul>{nodes.map(node => <li key={node.entity.id}>{node.entity.kind}: {node.entity.id} (depth {node.depth})</li>)}</ul>
    <div style={{ maxWidth: '100%', overflowX: 'auto' }} tabIndex={0} aria-label="Scrollable lineage assertions"><table><thead><tr><th>Direction</th><th>Relationship</th><th>Assertion</th><th>Run / method</th><th>Confidence</th><th>Privacy</th><th>Evidence</th></tr></thead><tbody>{edges.map(edge => <tr key={edge.assertion.id}>
      <td>{edge.assertion.sourceEntityId} → {edge.assertion.targetEntityId}</td><td>{edge.assertion.relationship} ({edge.status})</td><td>{edge.assertion.assertionKind}</td><td>{edge.assertion.producingActivityId ?? 'not recorded'} / {edge.assertion.method}</td><td>{edge.assertion.confidence}</td><td>{edge.assertion.privacy}</td><td>{edge.evidence?.map(item => `${item.locator} (${item.capturedAt})`).join(', ') || 'No readable evidence'}</td>
    </tr>)}</tbody></table></div>{(result.nextCursor || windowed) && <p>More results are available through the bounded continuation cursor or next visible window.</p>}</section>
}

export function DatasetWorkflowActions({ snapshot, onCheck, onPreview, onPlan }: { snapshot: DatasetWorkflowSnapshot; onCheck(): void; onPreview(): void; onPlan(): void }) {
  const invalid = Object.keys(snapshot.validation).length > 0
  return <nav aria-label="Dataset setup actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
    <button type="button" disabled={invalid || snapshot.phase === 'checking'} onClick={onCheck}>Check connection</button>
    <button type="button" disabled={invalid || snapshot.phase === 'previewing'} onClick={onPreview}>Preview safely</button>
    <button type="button" disabled={!snapshot.preview || snapshot.phase === 'planning'} onClick={onPlan}>Build immutable plan</button>
    <span style={visuallyHidden} aria-live="polite">Current phase: {snapshot.phase}</span>
  </nav>
}
