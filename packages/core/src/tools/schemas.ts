/**
 * Zod schemas for tool function inputs.
 *
 * These schemas are the contract between callers (e.g. Plinyverse bridge) and
 * the tool functions. All inputs are validated at the tool boundary so that
 * repository methods only receive well-typed data.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// capture_knowledge
// ---------------------------------------------------------------------------

export const CaptureKnowledgeInputSchema = z.object({
  action: z.enum(['create', 'bulk_create', 'from_template']),
  // For create
  content: z.string().optional(),
  title: z.string().optional(),
  format: z.enum(['markdown', 'plain', 'html']).default('markdown'),
  source: z.string().default('user'),
  visibility: z.enum(['private', 'shared', 'public']).default('private'),
  tags: z.array(z.string()).optional(),
  archive_id: z.string().optional(),
  // For bulk_create
  notes: z
    .array(
      z.object({
        content: z.string(),
        title: z.string().optional(),
        format: z.enum(['markdown', 'plain', 'html']).default('markdown'),
        tags: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  // For from_template
  template: z.string().optional(),
  variables: z.record(z.string()).optional(),
})

export type CaptureKnowledgeInput = z.infer<typeof CaptureKnowledgeInputSchema>

// ---------------------------------------------------------------------------
// manage_note
// ---------------------------------------------------------------------------

export const ManageNoteInputSchema = z.object({
  action: z.enum(['update', 'delete', 'restore', 'archive', 'unarchive', 'star', 'unstar']),
  note_id: z.string(),
  // For update
  title: z.string().optional(),
  content: z.string().optional(),
  format: z.string().optional(),
  visibility: z.string().optional(),
})

export type ManageNoteInput = z.infer<typeof ManageNoteInputSchema>

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string(),
  mode: z.enum(['text', 'semantic', 'hybrid']).default('text'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  tags: z.array(z.string()).optional(),
  collection_id: z.string().optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
  is_starred: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  format: z.enum(['markdown', 'plain', 'html']).optional(),
  source: z.string().optional(),
  visibility: z.enum(['private', 'shared', 'public']).optional(),
  include_facets: z.boolean().default(false),
})

export type SearchInput = z.infer<typeof SearchInputSchema>
