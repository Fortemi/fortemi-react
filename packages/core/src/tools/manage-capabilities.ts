import { z } from 'zod'
import { CapabilityManager } from '../capability-manager.js'
import type { CapabilityName, CapabilityState } from '../capability-manager.js'

export const ManageCapabilitiesInputSchema = z.object({
  action: z.enum(['list', 'enable', 'disable', 'status']),
  capability: z.string().optional(),
})
export type ManageCapabilitiesInput = z.infer<typeof ManageCapabilitiesInputSchema>

export interface CapabilityInfo {
  name: CapabilityName
  state: CapabilityState
  error?: string
}

export interface ManageCapabilitiesResult {
  action: string
  capabilities?: Array<{ name: CapabilityName; state: CapabilityState }>
  capability?: CapabilityInfo
}

export async function manageCapabilities(capabilityManager: CapabilityManager, rawInput: unknown): Promise<ManageCapabilitiesResult> {
  const input = ManageCapabilitiesInputSchema.parse(rawInput)

  switch (input.action) {
    case 'list': {
      return { action: 'list', capabilities: capabilityManager.listAll() }
    }
    case 'enable': {
      if (!input.capability) throw new Error('capability required for enable')
      const name = input.capability as CapabilityName
      await capabilityManager.enable(name)
      return {
        action: 'enable',
        capability: {
          name,
          state: capabilityManager.getState(name),
          error: capabilityManager.getError(name),
        },
      }
    }
    case 'disable': {
      if (!input.capability) throw new Error('capability required for disable')
      const name = input.capability as CapabilityName
      capabilityManager.disable(name)
      return {
        action: 'disable',
        capability: {
          name,
          state: capabilityManager.getState(name),
          error: capabilityManager.getError(name),
        },
      }
    }
    case 'status': {
      if (!input.capability) throw new Error('capability required for status')
      const name = input.capability as CapabilityName
      return {
        action: 'status',
        capability: {
          name,
          state: capabilityManager.getState(name),
          error: capabilityManager.getError(name),
        },
      }
    }
  }
}
