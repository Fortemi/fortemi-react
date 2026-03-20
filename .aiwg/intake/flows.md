# Flows, Sequences & State Machines — fortemi-browser

**Version**: 2026.3.0

---

## 1. Note Creation Pipeline

The full pipeline from user input to a fully-processed note with embeddings, AI revision, concept tags, and links.

```mermaid
sequenceDiagram
    participant UI as React UI
    participant Repo as NotesRepository
    participant Worker as PGlite Worker
    participant JQ as Job Queue Worker
    participant CM as Capability Manager
    participant EB as Event Bus

    UI->>Repo: create({ content, tags, revision_mode: 'standard' })

    Repo->>Worker: BEGIN
    Worker->>Worker: INSERT INTO note (id=UUIDv7, ...)
    Worker->>Worker: INSERT INTO note_original (content, hash=sha256)
    Worker->>Worker: INSERT INTO note_revised_current (content=original, is_user_edited=false)
    Worker->>Worker: INSERT INTO note_tag (for each tag)
    Worker->>Worker: INSERT INTO job_queue (type='ai_revision', priority=8)
    Worker->>Worker: INSERT INTO job_queue (type='title_generation', priority=2)
    Worker->>Worker: INSERT INTO job_queue (type='embedding', priority=5)
    Worker->>Worker: COMMIT
    Worker-->>Repo: { id, ... }

    Repo->>EB: emit('note.created', { id })
    Repo-->>UI: NoteFull (original content, no revision yet)

    Note over JQ: Job Queue Worker picks up jobs by priority

    par Phase 1 — independent fast jobs
        JQ->>Worker: UPDATE job status='running' WHERE type='title_generation'
        JQ->>CM: requireCapability('llm') OR extract from content
        JQ->>Worker: UPDATE note SET title=... WHERE id=note_id
        JQ->>Worker: UPDATE job status='completed'
        JQ->>EB: emit('note.updated', { id, fields: ['title'] })
    and
        JQ->>Worker: UPDATE job status='running' WHERE type='ai_revision'
        JQ->>CM: requireCapability('llm')
        alt LLM available
            CM-->>JQ: LLMModule ready
            JQ->>LLM: revise(original_content, mode='standard')
            LLM-->>JQ: revised_content
            JQ->>Worker: INSERT INTO note_revision (content=revised, type='ai_enhancement')
            JQ->>Worker: UPDATE note_revised_current SET content=revised, last_revision_id=...
            JQ->>Worker: INSERT INTO job_queue (type='concept_tagging', priority=5)
            JQ->>Worker: UPDATE job status='completed'
            JQ->>EB: emit('note.revised', { id })
        else LLM not available
            JQ->>Worker: UPDATE job status='pending' (stays queued)
            Note over JQ: Will re-run when LLM module is loaded
        end
    end

    par Phase 2 — after content settled
        JQ->>Worker: UPDATE job status='running' WHERE type='concept_tagging'
        JQ->>CM: requireCapability('llm')
        JQ->>LLM: tag(revised_content) → 8-15 SKOS concepts
        JQ->>Worker: INSERT INTO note_skos_tag (x8-15 rows)
        JQ->>Worker: UPDATE job status='completed'
        JQ->>EB: emit('note.tagged', { id, concepts })
    and
        JQ->>Worker: UPDATE job status='running' WHERE type='embedding'
        JQ->>CM: requireCapability('semantic')
        alt Embedding available
            CM-->>JQ: EmbeddingModule ready
            JQ->>EM: chunk(content) → text chunks
            JQ->>EM: embed(chunks) → Float32[768] per chunk
            JQ->>Worker: INSERT INTO embedding (chunk_index, text, vector) × N
            JQ->>Worker: UPDATE job status='completed'
            JQ->>EB: emit('embedding.ready', { id })
            JQ->>Worker: INSERT INTO job_queue (type='linking', priority=3)
        else Embedding not available
            JQ->>Worker: UPDATE job status='pending'
        end
    end

    par Phase 3 — semantic linking (requires embeddings)
        JQ->>Worker: UPDATE job status='running' WHERE type='linking'
        JQ->>Worker: SELECT FTS + vector candidates for linking
        JQ->>Worker: RRF fusion → top N candidates
        JQ->>Worker: INSERT INTO link (from_note_id, to_note_id, kind='semantic', score)
        JQ->>Worker: UPDATE job status='completed'
        JQ->>EB: emit('note.linked', { id, links })
    end
```

---

## 2. Job Queue State Machine

```mermaid
stateDiagram-v2
    [*] --> pending : Job inserted

    pending --> running : Worker picks up\n(by priority ASC, created_at ASC)

    running --> completed : Success\nresult stored in JSONB
    running --> failed : Error\nerror_message stored\nretry_count++

    failed --> pending : retry_count < max_retries\n(exponential backoff)
    failed --> [*] : retry_count >= max_retries\n(terminal failure)

    pending --> cancelled : user cancels
    running --> cancelled : user cancels\n(graceful stop)
    cancelled --> [*]

    completed --> [*]

    note right of pending
        Jobs waiting for a capability
        stay in 'pending' indefinitely
        until that capability loads.
        required_capability field
        determines eligibility.
    end note

    note right of running
        Only one job per note_id
        runs at a time to prevent
        revision race conditions.
    end note
```

---

## 3. Hybrid Search Flow

```mermaid
sequenceDiagram
    participant Client as UI / MCP Tool
    participant SR as SearchRepository
    participant Worker as PGlite Worker
    participant CM as Capability Manager

    Client->>SR: search({ q: 'rust memory safety', mode: 'hybrid', limit: 20, tags: ['programming'] })

    SR->>CM: isReady('semantic')

    alt Semantic module ready — full hybrid
        SR->>Worker: FTS query
        Note right of Worker: SELECT note_id, ts_rank(tsv, query) AS fts_score<br/>FROM note_revised_current<br/>WHERE tsv @@ plainto_tsquery('rust memory safety')<br/>AND [tag filters]<br/>ORDER BY fts_score DESC LIMIT 60
        Worker-->>SR: fts_results[(note_id, fts_score)]

        SR->>Worker: Vector query
        Note right of Worker: SELECT note_id, 1-(vector <=> $query_vector) AS vec_score<br/>FROM embedding<br/>ORDER BY vector <=> $query_vector LIMIT 60

        SR->>Worker: RRF fusion
        Note right of Worker: WITH fts AS (...), vec AS (...)<br/>SELECT note_id,<br/>  COALESCE(1.0/(60+fts.rank),0) +<br/>  COALESCE(1.0/(60+vec.rank),0) AS rrf_score<br/>FROM ... ORDER BY rrf_score DESC LIMIT 20

        Worker-->>SR: merged_results[(note_id, rrf_score)]
        SR->>Worker: Fetch note summaries for result IDs
        Worker-->>SR: NoteSummary[]
        SR-->>Client: SearchResponse { notes, semantic_available: true }

    else Semantic not available — FTS only
        SR->>Worker: FTS query (same as above)
        Worker-->>SR: fts_results
        SR->>Worker: Fetch note summaries
        Worker-->>SR: NoteSummary[]
        SR-->>Client: SearchResponse { notes, semantic_available: false, warnings: ['semantic_unavailable'] }
    end
```

---

## 4. Note Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> Active : note created\n(source: user|api|import)

    Active --> Processing : jobs queued\n(ai_revision, embedding, linking)
    Processing --> Active : all jobs completed

    Active --> Starred : user stars
    Starred --> Active : user unstars

    Active --> Archived : user archives
    Archived --> Active : user unarchives

    Active --> Deleted : user deletes\n(deleted_at = now())
    Archived --> Deleted : user deletes

    Deleted --> Active : user restores\n(deleted_at = NULL)
    Deleted --> [*] : user purges\n(hard delete + blob GC)

    note right of Processing
        Note is visible and usable
        while processing.
        Processing state is
        informational only.
    end note

    note right of Deleted
        Soft-deleted notes are
        excluded from all queries
        by default (WHERE deleted_at IS NULL).
        Preserved for sync tombstoning.
    end note
```

---

## 5. Attachment Processing Pipeline

```mermaid
sequenceDiagram
    participant UI as React UI
    participant AR as AttachmentsRepository
    participant Worker as PGlite Worker
    participant CM as Capability Manager
    participant OPFS as OPFS Blob Store

    UI->>AR: upload(note_id, file: File)

    AR->>AR: computeHash(file) → blake3:...
    AR->>Worker: SELECT id FROM attachment_blob WHERE content_hash = ?

    alt Blob already exists (deduplication)
        Worker-->>AR: { id: existing_blob_id }
        AR->>Worker: UPDATE attachment_blob SET reference_count = reference_count + 1
    else New blob
        alt size_bytes <= 10MB
            AR->>Worker: INSERT INTO attachment_blob (data=bytes, storage_backend='database')
        else size_bytes > 10MB
            AR->>OPFS: write file to blobs/{xx}/{xx}/{uuid}.bin
            AR->>Worker: INSERT INTO attachment_blob (storage_path=..., storage_backend='filesystem')
        end
    end

    AR->>Worker: INSERT INTO attachment (note_id, blob_id, status='queued')
    AR->>Worker: INSERT INTO job_queue (type='extraction', required_capability=inferred)
    Worker-->>AR: attachment_id

    Note over AR,Worker: Job queue worker picks up extraction job

    par Extraction (capability-dependent)
        alt PDF (pdf.js available)
            CM-->>JQ: PDFModule ready
            JQ->>JQ: extractText(blob) → text, pages, metadata
        else Image (vision available)
            CM-->>JQ: VisionModule ready
            JQ->>LLM: describe(image) → ai_description
        else Audio/Video (audio available)
            CM-->>JQ: AudioModule ready
            JQ->>Whisper: transcribe(audio) → text
        else No capability
            JQ->>Worker: UPDATE attachment SET status='completed'\n(stored, no text extraction)
        end
    end

    JQ->>Worker: UPDATE attachment SET\n  extracted_text=...,\n  extracted_metadata=...,\n  ai_description=...,\n  status='completed'
    JQ->>EB: emit('attachment.processed', { note_id, attachment_id })
    JQ->>Worker: INSERT INTO job_queue (type='embedding') -- re-embed note with new content
```

---

## 6. Attachment Blob GC (Reference Counting)

```mermaid
flowchart TD
    Delete["DELETE attachment WHERE id=?"] --> DecrRef["UPDATE attachment_blob\nSET reference_count = reference_count - 1\nWHERE id = blob_id"]
    DecrRef --> CheckRef{reference_count = 0?}
    CheckRef -->|No| Done["Done — blob still referenced\nby other attachments (deduplication)"]
    CheckRef -->|Yes| CheckBackend{storage_backend?}
    CheckBackend -->|database| DeleteRow["DELETE FROM attachment_blob WHERE id=?"]
    CheckBackend -->|filesystem| DeleteFile["OPFS: remove blobs/{path}"] --> DeleteRow
    DeleteRow --> Done2["Done — blob GC complete"]
```

---

## 7. Migration Strategy Flow

```mermaid
flowchart TD
    AppStart["App starts / archive opens"] --> CheckVersion["SELECT schema_version FROM archive WHERE name=?"]
    CheckVersion --> GetCurrent["Get current migration version\nfrom migration file list"]
    GetCurrent --> Compare{schema_version\n== latest?}
    Compare -->|Yes| Ready["Database ready\nOpen PGlite connection"]
    Compare -->|No| RunMigrations["Run pending migrations\nin sequence"]
    RunMigrations --> ForEach["For each migration N > schema_version:\n  BEGIN\n  execute migration SQL\n  UPDATE archive SET schema_version = N\n  COMMIT"]
    ForEach --> MoreMigrations{More pending?}
    MoreMigrations -->|Yes| ForEach
    MoreMigrations -->|No| Ready

    ServerMigration["Server adds new migration\n(e.g. 20260401_add_tenant_id.sql)"] --> BrowserMigration["Browser migration author\ncreates browser equivalent\n(same version number, adapted DDL)"]
    BrowserMigration --> Test["Format parity test:\nserver JSON fixture → import → re-export\nassert deep equality"]
    Test --> Merge["Merge to fortemi-browser\n(same CalVer as server migration)"]
```

**Browser migration file naming convention:**
```
migrations/
  0001_initial_schema.sql          ← adapted from server migration 20260102
  0002_skos_tagging.sql            ← adapted from server migration 20260118
  0003_attachments.sql             ← adapted from server migration 20260203
  0004_embedding_sets.sql          ← adapted from server migration 20260117
  0005_multi_memory.sql            ← adapted from server migration 20260201
  ...
```

**What gets adapted (not simply copied):**
- Remove: `CREATE ROLE`, `GRANT`, tablespaces, publications (not supported in PGlite)
- Remove: server-specific PostgreSQL extensions not in PGlite (e.g., `pg_partman`)
- Keep: `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `pgvector` extension, `tsvector GENERATED`
- Add: `CREATE INDEX` hints tuned for PGlite HNSW performance (may differ from server)

---

## 8. MCP Tool Request Flow

```mermaid
sequenceDiagram
    participant Agent as AI Agent (Claude/Cursor)
    participant MCP as MCP Client
    participant SW as Service Worker
    participant Tools as MCP Tool Handler
    participant Repo as Repository Layer
    participant Worker as PGlite Worker

    Agent->>MCP: call tool: capture_knowledge\n{ action: 'create', content: '...', tags: ['rust'] }
    MCP->>SW: POST /mcp HTTP/1.1\n{ method: 'tools/call', params: { name: 'capture_knowledge', ... } }

    SW->>Tools: dispatch('capture_knowledge', args)
    Tools->>Repo: notesRepo.create(content, tags, revision_mode)
    Repo->>Worker: SQL INSERT (via postMessage)
    Worker-->>Repo: { id, title, ... }
    Repo-->>Tools: NoteFull
    Tools->>Tools: format as MCP tool result
    Tools-->>SW: { content: [{ type: 'text', text: JSON }] }
    SW-->>MCP: HTTP 200 { result: ... }
    MCP-->>Agent: tool result

    Note over Agent: Agent receives same response format<br/>as if talking to the Rust server's MCP.
```

**38 Core MCP Tools — Browser implementation scope:**

```mermaid
mindmap
    root((MCP Tools))
        Note Management
            list_notes
            get_note
            capture_knowledge
                create
                bulk_create
                from_template
                upload
            manage_note
                update
                delete
                restore
                archive
                star
        Search
            search
                text
                semantic
                temporal
                federated
            explore_graph
            find_similar
        Organization
            manage_tags
                add
                remove
                create_scheme
            manage_collections
                create
                organize
            manage_links
                create
                update
                remove
        Processing
            reprocess_notes
            extract_from_file
            generate_metadata
        System
            list_document_types
            list_embedding_sets
            get_job_status
            get_documentation
```
