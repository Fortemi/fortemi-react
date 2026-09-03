import { useMemo, useSyncExternalStore } from 'react'
import { DatasetWorkflowMachine } from './machine.js'
import type { DatasetConfigSchema, DatasetWorkflowApi, DatasetWorkflowSnapshot } from './types.js'

export interface UseDatasetWorkflowResult extends DatasetWorkflowSnapshot {
  machine: DatasetWorkflowMachine
}

export function useDatasetWorkflow(schema: DatasetConfigSchema, api: DatasetWorkflowApi): UseDatasetWorkflowResult {
  const machine = useMemo(() => new DatasetWorkflowMachine(schema, api), [schema, api])
  const snapshot = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot)
  return { ...snapshot, machine }
}
