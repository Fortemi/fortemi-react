import { DatasetWorkflowError } from './types.js'
import type {
  DatasetConfigProperty,
  DatasetConfigSchema,
  DatasetConfiguration,
  DatasetJsonPrimitive,
  DatasetPlan,
  DatasetWorkflowApi,
  DatasetWorkflowSnapshot,
} from './types.js'

function cloneFreeze<T>(value: T): Readonly<T> {
  const clone = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return
    Object.freeze(item)
    Object.values(item).forEach(freeze)
  }
  freeze(clone)
  return clone
}

export function isSecretProperty(property: DatasetConfigProperty | undefined): boolean {
  return property?.writeOnly === true || property?.format === 'credential-reference' || property?.format === 'password'
}

export function sanitizeDatasetConfiguration(
  schema: DatasetConfigSchema,
  configuration: DatasetConfiguration,
): DatasetConfiguration {
  return Object.freeze(Object.fromEntries(Object.entries(configuration).map(([key, value]) => [
    key,
    isSecretProperty(schema.properties[key]!) && value ? '[write-only reference]' : value,
  ])))
}

function conditionalRequired(schema: DatasetConfigSchema, configuration: DatasetConfiguration): string[] {
  return (schema.allOf ?? []).flatMap(rule => {
    const matches = Object.entries(rule.if.properties).every(([key, predicate]) => configuration[key] === predicate.const)
      && (rule.if.required ?? []).every(key => configuration[key] !== undefined)
    return matches ? (rule.then.required ?? []) : []
  })
}

export function visibleDatasetConfigFields(schema: DatasetConfigSchema, configuration: DatasetConfiguration): string[] {
  const gated = new Set((schema.allOf ?? []).flatMap(rule => rule.then.required ?? []))
  const active = new Set(conditionalRequired(schema, configuration))
  return Object.keys(schema.properties).filter(key => !gated.has(key) || active.has(key))
}

export function validateDatasetConfiguration(
  schema: DatasetConfigSchema,
  configuration: DatasetConfiguration,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {}
  const required = new Set([...(schema.required ?? []), ...conditionalRequired(schema, configuration)])
  for (const key of visibleDatasetConfigFields(schema, configuration)) {
    const property = schema.properties[key]!
    const value = configuration[key]
    if (required.has(key) && (value === undefined || value === '')) {
      errors[key] = `${property.title ?? key} is required`
      continue
    }
    if (value === undefined || value === '') continue
    if (property.type === 'string' && typeof value !== 'string') errors[key] = 'Must be text'
    if ((property.type === 'number' || property.type === 'integer') && typeof value !== 'number') errors[key] = 'Must be a number'
    if (property.type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) errors[key] = 'Must be a whole number'
    if (property.type === 'boolean' && typeof value !== 'boolean') errors[key] = 'Must be true or false'
    if (typeof value === 'string' && property.minLength !== undefined && value.length < property.minLength) errors[key] = `Minimum length is ${property.minLength}`
    if (typeof value === 'string' && property.maxLength !== undefined && value.length > property.maxLength) errors[key] = `Maximum length is ${property.maxLength}`
    if (typeof value === 'string' && property.pattern && !new RegExp(property.pattern).test(value)) errors[key] = 'Does not match the required format'
    if (typeof value === 'number' && property.minimum !== undefined && value < property.minimum) errors[key] = `Minimum is ${property.minimum}`
    if (typeof value === 'number' && property.maximum !== undefined && value > property.maximum) errors[key] = `Maximum is ${property.maximum}`
    if (property.enum && !property.enum.includes(value)) errors[key] = 'Choose an allowed value'
  }
  return Object.freeze(errors)
}

export function initialDatasetConfiguration(schema: DatasetConfigSchema): DatasetConfiguration {
  return Object.freeze(Object.fromEntries(Object.entries(schema.properties)
    .filter(([, property]) => property.default !== undefined)
    .map(([key, property]) => [key, property.default!])))
}

export class DatasetWorkflowMachine {
  private snapshotValue: DatasetWorkflowSnapshot
  private controller?: AbortController
  private readonly writeOnlyValues = new Map<string, DatasetJsonPrimitive>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly schema: DatasetConfigSchema, private readonly api: DatasetWorkflowApi) {
    const configuration = initialDatasetConfiguration(schema)
    this.snapshotValue = cloneFreeze({ phase: 'configure', configuration, validation: validateDatasetConfiguration(schema, configuration) })
  }

  getSnapshot = (): DatasetWorkflowSnapshot => this.snapshotValue
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  private update(patch: Partial<DatasetWorkflowSnapshot>): void {
    this.snapshotValue = cloneFreeze({ ...this.snapshotValue, ...patch }) as DatasetWorkflowSnapshot
    this.listeners.forEach(listener => listener())
  }

  setField(key: string, value: DatasetJsonPrimitive): void {
    const property = this.schema.properties[key]
    if (!property) throw new Error(`Unknown configuration field ${key}`)
    if (isSecretProperty(property)) this.writeOnlyValues.set(key, value)
    const configuration = Object.freeze({ ...this.snapshotValue.configuration, [key]: isSecretProperty(property) && value ? '[write-only reference]' : value })
    this.update({ phase: 'configure', configuration, validation: validateDatasetConfiguration(this.schema, configuration), checkResults: undefined, preview: undefined, plan: undefined })
  }

  private begin(): AbortSignal {
    this.controller?.abort()
    this.controller = new AbortController()
    return this.controller.signal
  }

  abort(): void { this.controller?.abort() }

  private materializedConfiguration(): DatasetConfiguration {
    return Object.freeze({ ...this.snapshotValue.configuration, ...Object.fromEntries(this.writeOnlyValues) })
  }

  async check(): Promise<void> {
    if (Object.keys(this.snapshotValue.validation).length) return
    const signal = this.begin(); this.update({ phase: 'checking' })
    try { this.update({ phase: 'checked', checkResults: await this.api.check(this.materializedConfiguration(), signal) }) }
    catch (error) { this.fail(error) }
  }

  async preview(limit = 100): Promise<void> {
    if (Object.keys(this.snapshotValue.validation).length) return
    const signal = this.begin(); this.update({ phase: 'previewing' })
    try {
      const preview = await this.api.preview(this.materializedConfiguration(), Math.max(1, Math.min(1000, limit)), signal)
      if (!preview.bounded || !preview.sideEffectFree) throw new Error('Preview contract was not honored')
      this.update({ phase: 'previewed', preview })
    } catch (error) { this.fail(error) }
  }

  async buildPlan(): Promise<void> {
    if (!this.snapshotValue.preview) return
    const signal = this.begin(); this.update({ phase: 'planning' })
    try {
      const plan = cloneFreeze(await this.api.createPlan(sanitizeDatasetConfiguration(this.schema, this.snapshotValue.configuration), this.snapshotValue.preview, signal)) as DatasetPlan
      this.writeOnlyValues.clear()
      this.update({ phase: 'review', plan })
    }
    catch (error) { this.fail(error) }
  }

  async approve(confirmation?: string): Promise<void> {
    const plan = this.snapshotValue.plan
    if (!plan) return
    if (plan.reconciliation.destructive && plan.reconciliation.estimatedDeletes >= plan.reconciliation.confirmationThreshold && confirmation !== plan.id) {
      this.update({ diagnostic: { code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED', severity: 'error', summary: `Type ${plan.id} to confirm the reviewed destructive impact`, retryClass: 'after-change' } })
      return
    }
    const signal = this.begin(); this.update({ phase: 'approving', diagnostic: undefined })
    try {
      if (!(await this.api.verifyPlanDigest(plan, signal))) throw new Error('Plan digest changed before approval')
      const run = await this.api.approvePlan(plan, confirmation, signal)
      this.update({ phase: run.lifecycle === 'committed' ? 'complete' : 'running', run })
    } catch (error) { this.fail(error) }
  }

  async cancel(): Promise<void> {
    const run = this.snapshotValue.run
    if (!run || !['queued', 'running'].includes(run.lifecycle)) return
    const signal = this.begin()
    try { this.update({ run: await this.api.cancelRun(run.runId, signal), phase: 'running' }) } catch (error) { this.fail(error) }
  }

  async retry(): Promise<void> {
    const run = this.snapshotValue.run
    if (!run || run.retryClass === 'never') return
    const signal = this.begin()
    try { this.update({ run: await this.api.retryRun(run.runId, signal), phase: 'running' }) } catch (error) { this.fail(error) }
  }

  async refreshStatus(): Promise<void> {
    const signal = this.begin()
    try {
      const status = await this.api.getStatus(signal)
      const rejections = this.snapshotValue.run ? await this.api.getRejections(this.snapshotValue.run.runId, signal) : undefined
      this.update({ status, ...(rejections ? { rejections } : {}) })
    } catch (error) { this.fail(error) }
  }

  private fail(error: unknown): void {
    if (error instanceof DOMException && error.name === 'AbortError') return
    this.update({ phase: 'failed', diagnostic: error instanceof DatasetWorkflowError
      ? error.diagnostic
      : { code: 'DATASET_WORKFLOW_FAILED', severity: 'error', summary: 'The dataset workflow could not complete. No sensitive diagnostic details were displayed.', retryClass: 'after-change' } })
  }
}
