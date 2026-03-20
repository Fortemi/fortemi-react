# Software Architecture Document — fortemi-browser

**Version**: 2026.3.0
**Status**: Approved (intake phase)

---

## 1. System Context

fortemi-browser is a browser-native reimplementation of the Fortemi intelligent memory server. It runs entirely client-side using PGlite (PostgreSQL WASM) for structured storage and OPFS for file blobs. A Service Worker intercepts HTTP requests on `localhost:3000`, making the browser backend indistinguishable from the server to MCP tools and external integrations.

```mermaid
C4Context
    title System Context — fortemi-browser

    Person(user, "User", "Knowledge worker, researcher, developer")
    System(browser, "fortemi-browser", "Browser-only Fortemi memory system\nPGlite + OPFS + Service Worker\nReact/TypeScript PWA")
    System_Ext(server, "fortemi server", "Rust/PostgreSQL production server\nv2026.2.13\nOptional sync target")
    System_Ext(llm_api, "LLM API", "OpenAI / Anthropic / Ollama proxy\nOptional — user-configured")
    System_Ext(mcp_client, "MCP Client / AI Agent", "Claude, Cursor, or any MCP-compatible agent\ntargets localhost:3000")

    Rel(user, browser, "Creates notes, searches, tags")
    Rel(mcp_client, browser, "38 MCP tools via Service Worker\nHTTP on localhost:3000")
    Rel(browser, server, "Optional sync\n(post-v1, delta protocol)")
    Rel(browser, llm_api, "AI revision, concept tagging\nOptional — when LLM module configured")
```

---

## 2. Container Architecture

```mermaid
C4Container
    title Container Diagram — fortemi-browser

    Person(user, "User")

    Container_Boundary(pwa, "fortemi-browser PWA") {
        Container(ui, "React UI", "React 19 / TypeScript", "Views, components, routing")
        Container(eventbus, "Event Bus", "TypeScript", "Typed SSE-compatible reactive events\nDecouples UI from data layer")
        Container(api_layer, "API Layer", "TypeScript", "Repository pattern\nMirrors server REST surface")
        Container(sw, "Service Worker", "TypeScript", "Intercepts localhost:3000\nServes REST + MCP tools from PGlite")
        Container(cap_system, "Capability Module System", "TypeScript", "Feature flags + WASM loader\nOpt-in: Semantic, LLM, Audio, Vision, PDF")
        Container(pglite_worker, "PGlite Worker", "Web Worker / TypeScript", "Single-writer PostgreSQL WASM\nMessage-passing coordinator")
        ContainerDb(pglite_db, "PGlite Database(s)", "PostgreSQL WASM + pgvector\nOPFS-persisted", "One DB per archive\nopfs://fortemi-{name}")
        ContainerDb(opfs_blobs, "OPFS Blob Store", "Origin Private File System", "Raw file handles for attachments >10MB\nblobs/{xx}/{xx}/{uuid}.bin")
    }

    Container_Ext(wasm_models, "WASM Capability Modules", "transformers.js / WebLLM / Whisper.js", "Opt-in downloads\nCached after first load")
    Container_Ext(llm_api, "LLM API", "External", "Optional user-configured")

    Rel(user, ui, "Interacts with")
    Rel(ui, eventbus, "Subscribes to / publishes")
    Rel(ui, api_layer, "Calls")
    Rel(api_layer, pglite_worker, "SQL queries via message-passing")
    Rel(sw, api_layer, "Delegates to")
    Rel(pglite_worker, pglite_db, "Reads / writes")
    Rel(api_layer, opfs_blobs, "Reads / writes large files")
    Rel(cap_system, wasm_models, "Loads on demand")
    Rel(cap_system, llm_api, "Proxies to when configured")
    Rel(api_layer, eventbus, "Emits change events")
```

---

## 3. Layer Architecture

```mermaid
graph TB
    subgraph UI["UI Layer (React 19)"]
        Views["Views & Routes"]
        Components["Components"]
        Hooks["Custom Hooks\nuseNotes, useSearch, useTags"]
    end

    subgraph EventBus["Event Bus"]
        EB["Typed Event Emitter\nnote.created | note.updated | note.deleted\njob.queued | job.completed | embedding.ready\narchive.switched"]
    end

    subgraph APILayer["API Layer (Repository Pattern)"]
        NR["NotesRepository\ncreate, get, list, update, delete, restore"]
        SR["SearchRepository\nhybrid, fts, semantic, filter"]
        TR["TagsRepository\nSKOS concepts, schemes, tagging"]
        AR["AttachmentsRepository\nupload, extract, download"]
        CR["CollectionsRepository"]
        LR["LinksRepository"]
        JR["JobRepository\nqueue, status, cancel"]
        PR["ProvenanceRepository"]
    end

    subgraph CapSystem["Capability Module System"]
        CF["Capability Flags\nSemantic | LLM | Audio | Vision | PDF"]
        WL["WASM Loader\ndownload, verify, cache"]
        EM["EmbeddingModule\ntransformers.js\nnomic-embed-text 768-dim"]
        LM["LLMModule\nWebLLM or external API"]
        AM["AudioModule\nWhisper.js or external API"]
        VM["VisionModule\nWebLLM vision or external API"]
        PM["PDFModule\npdf.js + mammoth.js + SheetJS"]
    end

    subgraph SW["Service Worker"]
        Intercept["Request Interceptor\nlocalhost:3000 → PGlite"]
        MCPHandler["MCP Tool Handler\n38 core tools"]
        SWLifecycle["SW Lifecycle\nversioning, skip waiting, claim"]
    end

    subgraph PGliteWorker["PGlite Worker (single-writer)"]
        MsgRouter["Message Router\nrequest/response over postMessage"]
        PGL["PGlite Instance Pool\nactive + preloaded archives"]
        MigRunner["Migration Runner\nsequential numbered SQL files"]
        TXCoord["Transaction Coordinator"]
    end

    subgraph Storage["Storage"]
        OPFS_DB["OPFS — PGlite databases\nopfs://fortemi-{archive}"]
        OPFS_Blobs["OPFS — File blobs\nblobs/{xx}/{xx}/{uuid}.bin"]
    end

    Views --> Hooks
    Hooks --> APILayer
    Hooks --> EventBus
    APILayer --> EventBus
    APILayer --> PGliteWorker
    APILayer --> CapSystem
    APILayer --> OPFS_Blobs
    SW --> APILayer
    PGliteWorker --> OPFS_DB
    MigRunner --> OPFS_DB
```

---

## 4. PGlite Single-Writer Pattern

PGlite does not support concurrent write connections. All writes are serialized through a dedicated Web Worker using message-passing.

```mermaid
sequenceDiagram
    participant UI as React UI
    participant Repo as Repository Layer
    participant Worker as PGlite Worker
    participant DB as PGlite (OPFS)

    Note over Worker,DB: Single writer — all threads message through here

    UI->>Repo: notesRepo.create(content, tags)
    Repo->>Worker: postMessage({ type: 'query', sql, params, id: 'req-1' })

    activate Worker
    Worker->>DB: BEGIN
    Worker->>DB: INSERT INTO note ...
    Worker->>DB: INSERT INTO note_original ...
    Worker->>DB: INSERT INTO job_queue (type='ai_revision') ...
    Worker->>DB: COMMIT
    Worker-->>Repo: postMessage({ id: 'req-1', rows: [...] })
    deactivate Worker

    Repo->>EventBus: emit('note.created', { id, ... })
    Repo-->>UI: NoteFull

    Note over Worker,DB: Concurrent reads are safe — separate read connections allowed
```

---

## 5. Service Worker REST Interception

```mermaid
sequenceDiagram
    participant Agent as MCP Client / Agent
    participant SW as Service Worker
    participant Router as Request Router
    participant Repo as Repository Layer
    participant Worker as PGlite Worker

    Agent->>SW: POST http://localhost:3000/api/v1/notes
    activate SW

    SW->>Router: match('/api/v1/notes', 'POST')
    Router->>Repo: notesRepo.create(body)
    Repo->>Worker: SQL INSERT (via postMessage)
    Worker-->>Repo: { id: uuid, ... }
    Repo-->>Router: NoteFull JSON
    Router-->>SW: Response(201, body)
    SW-->>Agent: HTTP 201 { id, title, ... }
    deactivate SW

    Note over SW: Network requests to localhost:3000<br/>are fully intercepted — never hit the network.<br/>Identical response format to the Rust server.

    alt Server NOT running (offline)
        Agent->>SW: GET http://localhost:3000/api/v1/notes/uuid
        SW->>Router: match → PGlite query
        Router-->>SW: Response from local DB
        SW-->>Agent: 200 OK (from IndexedDB/PGlite)
    end

    alt fortemi server IS reachable (sync mode)
        Agent->>SW: Any request
        SW->>SW: Check sync mode flag
        SW-->>Agent: Proxy to remote server OR serve local
    end
```

---

## 6. Capability Module Loading

```mermaid
stateDiagram-v2
    [*] --> Unloaded : App starts

    Unloaded --> CheckCache : User enables module\nor first note requiring it

    CheckCache --> Loading : Not in cache
    CheckCache --> Initializing : Found in OPFS cache

    Loading --> Verifying : WASM downloaded
    Verifying --> Failed : Hash mismatch
    Verifying --> Initializing : Hash OK, written to cache

    Initializing --> Ready : Module initialized
    Initializing --> Failed : Init error (OOM, unsupported browser)

    Ready --> Unloading : User disables / memory pressure
    Unloading --> Unloaded

    Failed --> Unloaded : User retries

    note right of Ready
        Jobs requiring this module
        are now processed.
        Pending jobs in queue
        are picked up automatically.
    end note

    note right of Failed
        Jobs requiring this module
        stay in 'pending' state.
        graceful degradation —
        FTS search still works.
    end note
```

```mermaid
sequenceDiagram
    participant UI as Settings UI
    participant CM as Capability Manager
    participant WL as WASM Loader
    participant Cache as OPFS Cache
    participant JQ as Job Queue

    UI->>CM: enableModule('semantic')
    CM->>CM: setFlag('semantic', 'loading')
    CM->>EventBus: emit('capability.loading', { module: 'semantic' })

    CM->>WL: load('nomic-embed-text')
    WL->>Cache: checkCache('nomic-embed-text@v1.5')
    Cache-->>WL: miss

    WL->>CDN: fetch model shards (chunked)
    CDN-->>WL: shards
    WL->>WL: verify SHA-256 integrity
    WL->>Cache: write to OPFS
    WL->>WL: new pipeline('feature-extraction', model)
    WL-->>CM: EmbeddingModule instance

    CM->>CM: setFlag('semantic', 'ready')
    CM->>EventBus: emit('capability.ready', { module: 'semantic' })

    CM->>JQ: reactivatePending('embedding')
    Note over JQ: All notes without embeddings<br/>are now queued automatically
```

---

## 7. Archive / Multi-Memory Switching

```mermaid
stateDiagram-v2
    [*] --> DefaultArchive : App opens\nopfs://fortemi-public

    DefaultArchive --> Switching : user selects archive
    Switching --> LoadingArchive : open PGlite(opfs://fortemi-{name})

    LoadingArchive --> RunningMigrations : First open
    RunningMigrations --> ArchiveReady

    LoadingArchive --> ArchiveReady : Already at current schema version

    ArchiveReady --> ActiveArchive : Set as current instance

    ActiveArchive --> Switching : switch again

    note right of ActiveArchive
        All repo calls go to
        this PGlite instance.
        Event bus scope is
        per-archive.
    end note
```

```mermaid
graph LR
    subgraph Archives["PGlite Archive Instances"]
        A1["opfs://fortemi-public\n(default)"]
        A2["opfs://fortemi-work"]
        A3["opfs://fortemi-research"]
    end

    subgraph Worker["PGlite Worker"]
        Pool["Instance Pool\n{ name → PGlite }"]
        Active["active: 'public'"]
    end

    subgraph FederatedSearch["Federated Search (future)"]
        FS["Open all archives read-only\nMerge results with RRF\nReturn with archive tag"]
    end

    Active --> A1
    Pool --> A1
    Pool --> A2
    Pool --> A3
    FS --> A1
    FS --> A2
    FS --> A3
```
