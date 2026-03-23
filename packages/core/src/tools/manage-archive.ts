import { z } from 'zod'
import { ArchiveManager } from '../archive-manager.js'
import type { ArchiveInfo } from '../archive-manager.js'

export const ManageArchiveInputSchema = z.object({
  action: z.enum(['list', 'create', 'switch', 'delete']),
  name: z.string().optional(),
})
export type ManageArchiveInput = z.infer<typeof ManageArchiveInputSchema>

export interface ManageArchiveResult {
  action: string
  archives?: ArchiveInfo[]
  current?: string
  name?: string
}

export async function manageArchive(archiveManager: ArchiveManager, rawInput: unknown): Promise<ManageArchiveResult> {
  const input = ManageArchiveInputSchema.parse(rawInput)

  switch (input.action) {
    case 'list': {
      const archives = archiveManager.listArchives()
      return { action: 'list', archives, current: archiveManager.getCurrentArchiveName() }
    }
    case 'create': {
      if (!input.name) throw new Error('name required for create')
      await archiveManager.open(input.name)
      return { action: 'create', name: input.name, current: archiveManager.getCurrentArchiveName() }
    }
    case 'switch': {
      if (!input.name) throw new Error('name required for switch')
      await archiveManager.switchTo(input.name)
      return { action: 'switch', name: input.name, current: archiveManager.getCurrentArchiveName() }
    }
    case 'delete': {
      if (!input.name) throw new Error('name required for delete')
      await archiveManager.delete(input.name)
      return { action: 'delete', name: input.name }
    }
  }
}
