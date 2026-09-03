import { describe, expect, it, vi } from 'vitest'
import type { DatasetPreview, DatasetWorkflowApi } from '../types.js'
import { DatasetWorkflowMachine } from '../machine.js'
import { datasetConnectorFixtureSchema } from '../fixtures.js'

describe('dataset privacy and network boundaries', () => {
  it('keeps an offline preview local and never leaks write-only input to URL, history, console, snapshot, or plan', async () => {
    const fetchSpy = vi.fn()
    const historySpy = vi.fn()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const previousFetch = globalThis.fetch
    const previousHistory = globalThis.history
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchSpy })
    Object.defineProperty(globalThis, 'history', { configurable: true, value: { pushState: historySpy, replaceState: historySpy } })
    const preview: DatasetPreview = { bounded: true, sideEffectFree: true, limit: 10, datasets: [], estimate: { records: 0, networkBytes: 0 }, unsupportedCapabilities: [] }
    let serializedPlanInput = ''
    const api = {
      check: vi.fn(async () => []),
      preview: vi.fn(async () => preview),
      createPlan: vi.fn(async configuration => { serializedPlanInput = JSON.stringify(configuration); return { id: 'offline-plan', digest: 'sha256:plan', sourceRevision: '1', sourceDigest: 'sha256:source', configurationDigest: 'sha256:config', capabilities: [], transforms: [], locality: 'browser', outboundHosts: [], privacy: 'restricted', rights: 'approved', retention: 'session', estimatedWrites: 0, fallbackBehavior: 'offline only', reconciliation: { destructive: false, estimatedDeletes: 0, confirmationThreshold: 1 } } }),
      verifyPlanDigest: vi.fn(async () => true), approvePlan: vi.fn(), cancelRun: vi.fn(), retryRun: vi.fn(), getStatus: vi.fn(), getRejections: vi.fn(), traverseLineage: vi.fn(),
    } as unknown as DatasetWorkflowApi
    const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, api)
    machine.setField('mode', 'local'); machine.setField('endpoint', 'https://offline.example.test'); machine.setField('credentialReference', 'synthetic-private-reference')
    await machine.preview(10); await machine.buildPlan()
    expect(fetchSpy).not.toHaveBeenCalled(); expect(historySpy).not.toHaveBeenCalled(); expect(logSpy).not.toHaveBeenCalled(); expect(warnSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(machine.getSnapshot())).not.toContain('synthetic-private-reference')
    expect(serializedPlanInput).not.toContain('synthetic-private-reference')
    logSpy.mockRestore(); warnSpy.mockRestore()
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: previousFetch })
    Object.defineProperty(globalThis, 'history', { configurable: true, value: previousHistory })
  })
})
