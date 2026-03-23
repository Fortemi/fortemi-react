import type { PGlite } from '@electric-sql/pglite'
import { z } from 'zod'
import { CollectionsRepository } from '../repositories/collections-repository.js'
import type { CollectionRow } from '../repositories/collections-repository.js'

export const ManageCollectionsInputSchema = z.object({
  action: z.enum(['create', 'list', 'list_tree', 'assign', 'unassign', 'delete']),
  name: z.string().optional(),
  description: z.string().optional(),
  parent_id: z.string().optional(),
  collection_id: z.string().optional(),
  note_id: z.string().optional(),
})
export type ManageCollectionsInput = z.infer<typeof ManageCollectionsInputSchema>

export interface ManageCollectionsResult {
  action: string
  collection?: CollectionRow
  collections?: CollectionRow[]
  tree?: Array<CollectionRow & { children: CollectionRow[] }>
  collection_id?: string
  note_id?: string
}

export async function manageCollections(db: PGlite, rawInput: unknown): Promise<ManageCollectionsResult> {
  const input = ManageCollectionsInputSchema.parse(rawInput)
  const repo = new CollectionsRepository(db)

  switch (input.action) {
    case 'create': {
      if (!input.name) throw new Error('name required for create')
      const collection = await repo.create({ name: input.name, description: input.description, parent_id: input.parent_id })
      return { action: 'create', collection }
    }
    case 'list': {
      const collections = await repo.list()
      return { action: 'list', collections }
    }
    case 'list_tree': {
      const tree = await repo.listTree()
      return { action: 'list_tree', tree }
    }
    case 'assign': {
      if (!input.collection_id || !input.note_id) throw new Error('collection_id and note_id required')
      await repo.assignNote(input.collection_id, input.note_id)
      return { action: 'assign', collection_id: input.collection_id, note_id: input.note_id }
    }
    case 'unassign': {
      if (!input.collection_id || !input.note_id) throw new Error('collection_id and note_id required')
      await repo.unassignNote(input.collection_id, input.note_id)
      return { action: 'unassign', collection_id: input.collection_id, note_id: input.note_id }
    }
    case 'delete': {
      if (!input.collection_id) throw new Error('collection_id required for delete')
      await repo.delete(input.collection_id)
      return { action: 'delete', collection_id: input.collection_id }
    }
  }
}
