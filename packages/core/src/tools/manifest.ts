/**
 * FortemiToolManifest — registry of all Mnemos tool definitions.
 *
 * Defines the full set of tool schemas and provides PlinyCapability
 * projection for bridge registration. Each tool definition follows the
 * WHEN/WHAT/HOW/OUT description pattern so consumers understand call sites.
 *
 * The 10 tools defined here are the initial subset covering core Mnemos
 * operations. Additional tools will be added incrementally as repositories
 * are implemented.
 */

import { z, type ZodType } from 'zod'
import {
  CaptureKnowledgeInputSchema,
  ManageNoteInputSchema,
  SearchInputSchema,
} from './schemas.js'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface FortemiToolDefinition {
  id: string
  name: string
  description: string
  category: 'capture' | 'search' | 'manage' | 'organize' | 'process' | 'analyze' | 'system'
  inputSchema: ZodType
  tags: string[]
  sideEffects: boolean
  requiredCapability?: string
}

export interface PlinyCapability {
  id: string
  name: string
  description: string
  inputSchema: Record<string, unknown> // JSON Schema 7
  tags: string[]
  sideEffects: boolean
}

// ---------------------------------------------------------------------------
// Zod → JSON Schema conversion (simplified)
//
// A full implementation would delegate to `zod-to-json-schema`. This version
// handles the concrete shapes used by Mnemos tools and is sufficient for
// PlinyCapability projection until the dependency is added.
// ---------------------------------------------------------------------------

function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodType>
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = resolvePropertySchema(value)

      // Required = not Optional and not Default
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key)
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    }
  }

  return { type: 'object' }
}

function resolvePropertySchema(value: ZodType): Record<string, unknown> {
  if (value instanceof z.ZodString) return { type: 'string' }
  if (value instanceof z.ZodNumber) return { type: 'number' }
  if (value instanceof z.ZodBoolean) return { type: 'boolean' }
  if (value instanceof z.ZodEnum) return { type: 'string', enum: value.options }
  if (value instanceof z.ZodArray) return { type: 'array' }
  if (value instanceof z.ZodRecord) return { type: 'object' }
  if (value instanceof z.ZodOptional) return resolvePropertySchema(value.unwrap())
  if (value instanceof z.ZodDefault) return resolvePropertySchema(value._def.innerType)
  if (value instanceof z.ZodObject) return zodToJsonSchema(value)
  return {}
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS: FortemiToolDefinition[] = [
  {
    id: 'mnemos.capture_knowledge',
    name: 'Capture Knowledge',
    description:
      'WHEN you have text, ideas, or information to save. WHAT creates one or more notes in Fortemi. HOW accepts content, optional title/tags, supports create/bulk_create/from_template. OUT returns the created note(s) with full metadata.',
    category: 'capture',
    inputSchema: CaptureKnowledgeInputSchema,
    tags: ['create', 'notes', 'capture'],
    sideEffects: true,
  },
  {
    id: 'mnemos.manage_note',
    name: 'Manage Note',
    description:
      'WHEN you need to modify an existing note. WHAT updates, deletes, restores, archives, or stars a note. HOW accepts note_id and action (update/delete/restore/archive/star). OUT returns the updated note.',
    category: 'manage',
    inputSchema: ManageNoteInputSchema,
    tags: ['update', 'delete', 'notes'],
    sideEffects: true,
  },
  {
    id: 'mnemos.search',
    name: 'Search Notes',
    description:
      'WHEN you need to find notes by content or metadata. WHAT performs full-text search across all notes. HOW accepts query string with optional tag/collection filters. OUT returns ranked results with highlighted snippets.',
    category: 'search',
    inputSchema: SearchInputSchema,
    tags: ['search', 'find', 'query'],
    sideEffects: false,
  },
  {
    id: 'mnemos.get_note',
    name: 'Get Note',
    description:
      'WHEN you need the full content of a specific note. WHAT retrieves a single note by ID. HOW accepts note_id. OUT returns complete note with content, metadata, tags, and revision info.',
    category: 'manage',
    inputSchema: z.object({ note_id: z.string() }),
    tags: ['read', 'notes'],
    sideEffects: false,
  },
  {
    id: 'mnemos.list_notes',
    name: 'List Notes',
    description:
      'WHEN you need to browse or filter notes. WHAT lists notes with pagination and filtering. HOW accepts optional filters (starred, archived, tags, collection). OUT returns paginated note summaries.',
    category: 'manage',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      sort: z.enum(['created_at', 'updated_at', 'title']).default('created_at'),
      order: z.enum(['asc', 'desc']).default('desc'),
      is_starred: z.boolean().optional(),
      is_archived: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      collection_id: z.string().optional(),
    }),
    tags: ['list', 'browse', 'notes'],
    sideEffects: false,
  },
  {
    id: 'mnemos.manage_tags',
    name: 'Manage Tags',
    description:
      'WHEN you need to organize notes with tags. WHAT adds or removes tags from notes. HOW accepts note_id, action (add/remove), and tag string. OUT confirms the tag operation.',
    category: 'organize',
    inputSchema: z.object({
      action: z.enum(['add', 'remove', 'list']),
      note_id: z.string().optional(),
      tag: z.string().optional(),
    }),
    tags: ['tags', 'organize'],
    sideEffects: true,
  },
  {
    id: 'mnemos.manage_collections',
    name: 'Manage Collections',
    description:
      'WHEN you need to organize notes into folders. WHAT creates, updates, or manages collections. HOW accepts collection operations (create/list/assign/delete). OUT returns collection data.',
    category: 'organize',
    inputSchema: z.object({
      action: z.enum(['create', 'list', 'assign', 'unassign', 'delete']),
      name: z.string().optional(),
      collection_id: z.string().optional(),
      note_id: z.string().optional(),
    }),
    tags: ['collections', 'folders', 'organize'],
    sideEffects: true,
  },
  {
    id: 'mnemos.manage_links',
    name: 'Manage Links',
    description:
      'WHEN you need to connect related notes. WHAT creates bidirectional links between notes. HOW accepts source/target note IDs and link type. OUT returns the link data.',
    category: 'organize',
    inputSchema: z.object({
      action: z.enum(['create', 'list', 'delete']),
      source_note_id: z.string().optional(),
      target_note_id: z.string().optional(),
      link_id: z.string().optional(),
      link_type: z.string().default('related'),
    }),
    tags: ['links', 'connections'],
    sideEffects: true,
  },
  {
    id: 'mnemos.manage_archive',
    name: 'Manage Archive',
    description:
      'WHEN you need to switch between or manage knowledge archives. WHAT creates, lists, switches, or deletes archives. HOW accepts archive name and operation. OUT returns archive info.',
    category: 'system',
    inputSchema: z.object({
      action: z.enum(['list', 'create', 'switch', 'delete']),
      name: z.string().optional(),
    }),
    tags: ['archive', 'system'],
    sideEffects: true,
  },
  {
    id: 'mnemos.manage_capabilities',
    name: 'Manage Capabilities',
    description:
      'WHEN you need to enable optional features like vector search or LLM. WHAT enables, disables, or queries WASM capability modules. HOW accepts capability name and action. OUT returns capability status.',
    category: 'system',
    inputSchema: z.object({
      action: z.enum(['list', 'enable', 'disable', 'status']),
      capability: z.string().optional(),
    }),
    tags: ['capabilities', 'system', 'wasm'],
    sideEffects: true,
  },
]

// ---------------------------------------------------------------------------
// FortemiToolManifest
// ---------------------------------------------------------------------------

export class FortemiToolManifest {
  private tools: Map<string, FortemiToolDefinition>

  constructor() {
    this.tools = new Map()
    for (const tool of TOOL_DEFINITIONS) {
      this.tools.set(tool.id, tool)
    }
  }

  /** Look up a single tool by its fully-qualified id. */
  get(id: string): FortemiToolDefinition | undefined {
    return this.tools.get(id)
  }

  /** Return all registered tools as a snapshot array. */
  list(): FortemiToolDefinition[] {
    return [...this.tools.values()]
  }

  /** Return tools matching a custom predicate. */
  filter(predicate: (tool: FortemiToolDefinition) => boolean): FortemiToolDefinition[] {
    return this.list().filter(predicate)
  }

  /** Return tools belonging to a specific category. */
  byCategory(category: string): FortemiToolDefinition[] {
    return this.filter(t => t.category === category)
  }

  /**
   * Full-text search across tool name, description, and tags.
   * Case-insensitive.
   */
  search(query: string): FortemiToolDefinition[] {
    const q = query.toLowerCase()
    return this.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.includes(q)),
    )
  }

  /** Project all tools as PlinyCapability entries for bridge registration. */
  toPlinyCapabilities(): PlinyCapability[] {
    return this.list().map(tool => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
      tags: tool.tags,
      sideEffects: tool.sideEffects,
    }))
  }

  /** Return the count of tools in each category. */
  getCategoryCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const tool of this.tools.values()) {
      counts[tool.category] = (counts[tool.category] ?? 0) + 1
    }
    return counts
  }
}

// Convenience singleton — use this in application code.
export const fortemiManifest = new FortemiToolManifest()
