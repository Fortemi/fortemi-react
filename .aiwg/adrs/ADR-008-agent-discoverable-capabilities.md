# ADR-008: Agent-Discoverable Tool Manifest

**Date**: 2026-03-22
**Status**: Proposed
**Deciders**: roctinam

---

## Context

fortemi-browser exposes 38 MCP tools (see UC-004). Two distinct consumers discover and invoke these tools at runtime:

1. **Plinyverse agents** (G0DM0D3 shell) discover tools via the `PlinyCapability` registry interface, which includes `inputSchema`/`outputSchema` (JSON Schema 7), `tags`, `sideEffects`, and rich `description` fields. Agents use this metadata to decide when and how to invoke tools without hardcoded tool knowledge.

2. **External MCP clients** (Claude Desktop, Cursor) discover tools via the `tools/list` JSON-RPC method, which returns tool definitions with JSON Schema parameter descriptions per the MCP specification.

The current architecture (ADR-004) defines tools as REST endpoints with JSON-RPC dispatch but does not specify how tool metadata is authored, stored, or projected to different consumers. Without a single source of truth, each integration point would maintain its own metadata definition across 38 tools.

Additionally, agent self-guidance requires metadata that goes beyond what either protocol mandates: when to use a tool, how parameters interact, what output shapes to expect, and which tools chain together.

## Decision

Define a **FortemiToolManifest** as the single source of truth for all 38 tool definitions. Each tool entry conforms to the `FortemiToolDefinition` interface:

```typescript
interface FortemiToolDefinition {
  id: string                      // Namespaced: 'mnemos.<tool_name>'
  name: string                    // Human-readable display name
  description: string             // Agent-readable: WHEN/WHAT/HOW/OUT pattern
  category: ToolCategory
  inputSchema: JSONSchema7        // Full parameter schema with constraints
  outputSchema: JSONSchema7       // Return value schema
  tags: string[]                  // For filtered discovery
  sideEffects: boolean            // Does invocation mutate state?
  examples?: ToolExample[]        // Input/output pairs for few-shot guidance
  relatedTools?: string[]         // Tool chaining suggestions
  requiredCapability?: string     // Capability gate (e.g., 'semantic', 'llm')
}

type ToolCategory =
  | 'capture'    // Creating and importing knowledge
  | 'search'     // Finding and retrieving knowledge
  | 'manage'     // Updating, deleting, restoring notes
  | 'organize'   // Tags, collections, links
  | 'analyze'    // Graph exploration, statistics, similarity
  | 'process'    // Embedding, revision, extraction jobs
  | 'system'     // Configuration, documentation, job status

interface ToolExample {
  description: string
  input: Record<string, unknown>
  output: Record<string, unknown>
}
```

The manifest is authored using **Zod schemas**, which generate both TypeScript types and JSON Schema 7 at build time. This eliminates schema drift between runtime validation and published metadata.

### Projection Targets

The manifest generates four outputs from the single source:

```
                    ┌────────────────────────────┐
                    │   FortemiToolManifest       │
                    │   (Zod source schemas)      │
                    └─────────────┬──────────────┘
                                  │
               ┌──────────────────┼──────────────────┐
               │                  │                  │
               ▼                  ▼                  ▼
     ┌───────────────┐  ┌───────────────┐  ┌────────────────┐
     │ PlinyCapab-   │  │  MCP tools/   │  │  TypeScript    │
     │ ility[]       │  │  list resp    │  │  interfaces    │
     └───────────────┘  └───────────────┘  └────────────────┘
     Plinyverse          External MCP       Type-safe tool
     bridge reg.         clients            invocation
```

### Agent Guidance in Descriptions

The `description` field follows a structured pattern for agent consumption:

```
WHEN: <trigger scenarios — when to consider this tool>
WHAT: <action + effect — what it does>
HOW:  <parameter guidance — key params, defaults, constraints>
OUT:  <output shape + edge cases — what to expect>
```

### Tool Inventory (38 Tools by Category)

| Category | Tools | Side Effects | Capabilities |
|---|---|---|---|
| **capture** | `capture_knowledge`, `import_notes`, `capture_from_url`, `upload_attachment` | yes | -- |
| **search** | `search`, `find_similar`, `explore_graph`, `search_by_tag`, `search_by_date`, `federated_search` | no | semantic (for vector modes) |
| **manage** | `get_note`, `list_notes`, `manage_note`, `manage_revision`, `manage_attachments` | varies | -- |
| **organize** | `manage_tags`, `manage_skos_tags`, `manage_collections`, `manage_links`, `manage_provenance`, `bulk_tag`, `bulk_organize`, `merge_notes` | yes | -- |
| **process** | `reprocess_notes`, `generate_embeddings`, `extract_from_file` | yes | semantic/llm/pdf |
| **analyze** | `get_note_graph`, `get_statistics`, `get_tag_cloud`, `get_concept_hierarchy` | no | -- |
| **system** | `list_document_types`, `list_embedding_sets`, `get_job_status`, `manage_archive`, `manage_capabilities`, `manage_api_keys`, `get_documentation` | varies | -- |

### Representative Tool Definitions

#### capture_knowledge (capture, write, multi-action)

```typescript
{
  id: 'mnemos.capture_knowledge',
  name: 'Capture Knowledge',
  description: `WHEN: User provides content to remember — text, ideas, notes, meeting summaries, code snippets.
WHAT: Creates a new note with optional AI revision, auto-tagging, and embedding generation.
HOW: 'content' is required (1-100K chars). 'tags' pre-assigns labels. 'revision_mode' controls AI processing: 'standard' (full revision), 'light' (grammar only), 'none' (store as-is). Default: 'standard'.
OUT: Returns full NoteFull object with id, timestamps, job queue status. Jobs for revision/embedding/tagging run asynchronously — check job_status for completion.`,
  category: 'capture',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 100000 },
      tags: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50 },
      revision_mode: { type: 'string', enum: ['standard', 'light', 'none'], default: 'standard' },
      document_type: { type: 'string', description: 'Slug from list_document_types' },
      source: { type: 'string', enum: ['user', 'agent', 'import'], default: 'agent' },
    },
    required: ['content'],
  },
  outputSchema: { $ref: '#/definitions/NoteFull' },
  tags: ['notes', 'write', 'primary'],
  sideEffects: true,
  relatedTools: ['mnemos.search', 'mnemos.manage_tags', 'mnemos.get_job_status'],
  examples: [{
    description: 'Capture a simple note',
    input: { content: 'Rust ownership model prevents data races at compile time', tags: ['rust', 'programming'] },
    output: { id: '019...',  title: null, source: 'agent', revision_mode: 'standard', job_status: { ai_revision: 'pending', embedding: 'pending' } },
  }],
}
```

#### search (search, read-only, capability-aware)

```typescript
{
  id: 'mnemos.search',
  name: 'Search Memory',
  description: `WHEN: User asks to find, recall, or look up previously captured knowledge.
WHAT: Hybrid search combining BM25 full-text and vector similarity (if semantic capability enabled). Results ranked by Reciprocal Rank Fusion (k=60).
HOW: 'q' is required. 'mode' selects search type: 'hybrid' (default, best quality), 'fts' (text only, always available), 'semantic' (vector only, requires semantic capability). 'limit' defaults to 20 (max 100). 'tags' filters results.
OUT: Returns SearchResponse with ranked notes (NoteSummary[]), mode used, and whether semantic was available. If semantic requested but unavailable, falls back to 'fts' automatically.`,
  category: 'search',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', minLength: 1 },
      mode: { type: 'string', enum: ['hybrid', 'fts', 'semantic'], default: 'hybrid' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      tags: { type: 'array', items: { type: 'string' } },
      archive: { type: 'string', description: 'Search specific archive (default: active)' },
    },
    required: ['q'],
  },
  outputSchema: { $ref: '#/definitions/SearchResponse' },
  tags: ['search', 'read', 'primary'],
  sideEffects: false,
  requiredCapability: undefined, // fts always available; semantic mode gracefully degrades
  relatedTools: ['mnemos.find_similar', 'mnemos.get_note', 'mnemos.explore_graph'],
  examples: [{
    description: 'Search for Rust notes',
    input: { q: 'rust memory safety', mode: 'hybrid', limit: 5 },
    output: { notes: [{ id: '019...', title: 'Rust Ownership', score: 0.87 }], mode: 'hybrid', semantic_available: true, total: 12 },
  }],
}
```

### Discovery Protocol

```typescript
// Plinyverse bridge: register capabilities on organ mount
bridge.capability.register(manifest.toPlinyCapabilities())

// MCP JSON-RPC: respond to tools/list
handler('tools/list', () => ({ tools: manifest.toMCPTools() }))

// Programmatic: direct access
const tools = manifest.list()
const tool = manifest.get('mnemos.capture_knowledge')
const searchTools = manifest.listByCategory('search')
const writeTools = manifest.listByTag('write')
```

### Projection Implementations

```typescript
// PlinyCapability projection
function toPlinyCapability(tool: FortemiToolDefinition): PlinyCapability {
  return {
    id: tool.id,
    organId: 'mnemos',
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    tags: tool.tags,
    sideEffects: tool.sideEffects,
  }
}

// MCP tool projection (input-only per MCP spec, no namespace prefix)
function toMCPTool(tool: FortemiToolDefinition): MCPToolDefinition {
  return {
    name: tool.id.replace('mnemos.', ''),
    description: tool.description,
    inputSchema: tool.inputSchema,
  }
}
```

### Zod Schema Derivation

```typescript
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

const CaptureKnowledgeInput = z.object({
  content: z.string().min(1).max(100000),
  tags: z.array(z.string().max(100)).max(50).optional(),
  revision_mode: z.enum(['standard', 'light', 'none']).default('standard'),
  source: z.enum(['user', 'agent', 'import']).default('agent'),
})

// Runtime validation
const validated = CaptureKnowledgeInput.parse(rawInput)

// JSON Schema generation (build-time)
const jsonSchema = zodToJsonSchema(CaptureKnowledgeInput)

// TypeScript type derivation
type CaptureKnowledgeArgs = z.infer<typeof CaptureKnowledgeInput>
```

## Consequences

**Positive:**
- Single source of truth for all tool metadata — Plinyverse and MCP consumers always agree
- Agents can self-guide using structured descriptions + examples without hardcoded prompts
- Category/tag system enables filtered discovery for different agent contexts
- `relatedTools` enables agent tool-chaining (capture → search → organize)
- `requiredCapability` enables graceful degradation (semantic unavailable → fts fallback)
- Zod generates types + schemas from one definition — zero drift
- `examples` field provides few-shot guidance directly in the manifest

**Negative:**
- 38 detailed tool definitions require maintenance discipline (mitigated: build-time completeness check validates all tools have required fields)
- Zod is an additional dependency (mitigated: already standard in TypeScript ecosystem, pure JS, small)
- Description convention (WHEN/WHAT/HOW/OUT) is enforced by convention, not schema (mitigated: linter rule can check pattern)

## Related Decisions

- **ADR-006** — Public API as primary interface (tools are part of that API)
- **ADR-007** — Deployment modes (manifest serves both organ and standalone)
- **UC-004** — MCP tool integration (full tool enumeration)
