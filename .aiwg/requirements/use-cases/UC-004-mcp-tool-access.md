# UC-004 — MCP Tool Access

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: Critical (Phase 6 — MCP + Polish)
**Actors**: AI Agent (Claude, Cursor, or any MCP-compatible client)
**Implements**: MCP Tool Request Flow (see `flows.md` §8)

---

## Brief Description

An AI agent accesses the fortemi-browser MCP server via the Service Worker REST API interception layer. The agent calls any of the 38 core MCP tools and receives responses identical in format to those from the fortemi Rust server. No server deployment required — the browser itself is the MCP endpoint.

---

## Preconditions

- Service Worker is registered and active at `localhost:3000`
- PGlite Worker is initialized and migration-current
- MCP client (Claude Desktop, Cursor, etc.) is configured to connect to `http://localhost:3000/mcp`

---

## Primary Flow

1. AI agent calls MCP tool: `tools/call { name: 'capture_knowledge', arguments: { action: 'create', content: '...', tags: ['rust'] } }`
2. MCP client sends: `POST http://localhost:3000/mcp` with JSON-RPC body
3. Service Worker intercepts the fetch event (same-origin, localhost:3000)
4. Service Worker parses JSON-RPC request: `{ method: 'tools/call', params: { name, arguments } }`
5. Service Worker routes to MCP tool dispatcher: `dispatch('capture_knowledge', args)`
6. Tool handler calls Repository layer: `NotesRepository.create(content, tags, revision_mode)`
7. Repository communicates with PGlite Worker via postMessage
8. PGlite Worker executes SQL, returns result
9. Tool handler formats response as MCP content block: `{ content: [{ type: 'text', text: JSON.stringify(noteFull) }] }`
10. Service Worker returns HTTP 200 with JSON-RPC result
11. MCP client delivers result to AI agent

---

## 38 Core MCP Tools

**Note Management**:
| Tool | Action | Description |
|---|---|---|
| `list_notes` | list | List notes with filters |
| `get_note` | get | Get full note by ID |
| `capture_knowledge` | create | Create note |
| `capture_knowledge` | bulk_create | Create multiple notes |
| `capture_knowledge` | from_template | Create from document type template |
| `capture_knowledge` | upload | Create note with attachment |
| `manage_note` | update | Update note content/metadata |
| `manage_note` | delete | Soft-delete note |
| `manage_note` | restore | Restore soft-deleted note |
| `manage_note` | archive | Archive note |
| `manage_note` | star | Star/unstar note |

**Search**:
| Tool | Action | Description |
|---|---|---|
| `search` | text | FTS search |
| `search` | semantic | Vector search |
| `search` | temporal | Date-range search |
| `search` | federated | Multi-archive search |
| `explore_graph` | — | Explore note link graph |
| `find_similar` | — | Find similar notes by embedding |

**Organization**:
| Tool | Action | Description |
|---|---|---|
| `manage_tags` | add | Add tags to note |
| `manage_tags` | remove | Remove tags from note |
| `manage_tags` | create_scheme | Create SKOS scheme |
| `manage_collections` | create | Create collection |
| `manage_collections` | organize | Move notes between collections |
| `manage_links` | create | Create note-to-note link |
| `manage_links` | update | Update link metadata |
| `manage_links` | remove | Remove link |

**Processing**:
| Tool | Action | Description |
|---|---|---|
| `reprocess_notes` | — | Re-queue processing jobs |
| `extract_from_file` | — | Extract content from attachment |
| `generate_metadata` | — | Generate title, tags, concepts |

**System**:
| Tool | Action | Description |
|---|---|---|
| `list_document_types` | — | List available document types |
| `list_embedding_sets` | — | List embedding sets |
| `get_job_status` | — | Check async job status |
| `get_documentation` | — | Get tool documentation |

---

## Alternative Flows

### 4a — Tool not found

Service Worker cannot find tool handler. Returns JSON-RPC error: `{ error: { code: -32601, message: 'Method not found' } }`.

### 4b — MCP tool list request

Agent calls `tools/list`. Service Worker returns array of all 38 tool definitions with schemas.

### 6a — Repository error

PGlite Worker returns error. Tool handler returns JSON-RPC error with appropriate code.

### 3a — Service Worker not registered

`fetch()` to `localhost:3000` fails (SW not active). MCP client receives connection refused. User must open fortemi-browser tab to activate Service Worker.

---

## Postconditions

- MCP tool result is identical in format to fortemi server response
- Database state updated per the tool's action
- Relevant events emitted on Event Bus (note.created, etc.)

---

## Business Rules

- BR-001: All 38 tool response formats must match fortemi server exactly (format parity)
- BR-002: Error codes must match server error codes for agent compatibility
- BR-003: Service Worker must remain active for MCP tools to be accessible
- BR-004: Tool calls must be atomic (all-or-nothing for write operations)
- BR-005: Tools that require capabilities (semantic, llm) must return graceful degradation, not errors, when capability unavailable

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | `capture_knowledge` via MCP returns server-identical format | Format parity assertion passes |
| AT-002 | `search` via MCP with FTS returns correct results | Results match direct repository query |
| AT-003 | `tools/list` returns all 38 tool definitions | 38 tools with correct schemas |
| AT-004 | Invalid tool name returns JSON-RPC -32601 | Error code and message correct |
| AT-005 | `get_note` for non-existent note returns -32602 | Error with 'note_not_found' detail |
| AT-006 | MCP tool with LLM action when LLM unavailable | Returns note without AI revision; `warnings: ['llm_unavailable']` |
| AT-007 | Concurrent MCP tool calls | All succeed; no write conflicts |

---

## Non-Functional Requirements

- FP-001: All 38 tool response formats match server OpenAPI shapes exactly
- PERF-001: MCP tool call latency < 300ms p95 (excluding WASM ops)
- REL-006: Tools work offline (no network required)
