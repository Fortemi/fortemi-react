# Data Model — fortemi-browser

**Version**: 2026.3.0
**Reference**: fortemi server `matric-core/src/models.rs` + `migrations/`
**Storage**: PGlite (PostgreSQL WASM) — all types are native PostgreSQL

---

## 1. Full Entity Relationship Overview

```mermaid
erDiagram
    note ||--o| note_original : "has one"
    note ||--o| note_revised_current : "has one"
    note ||--o{ note_revision : "has many"
    note ||--o{ attachment : "has many"
    note ||--o{ embedding : "has many chunks"
    note ||--o{ note_tag : "has many"
    note ||--o{ note_skos_tag : "has many"
    note ||--o{ link : "from"
    note ||--o{ link : "to"
    note ||--o{ job_queue : "triggers"
    note ||--o{ provenance_edge : "via revision"
    note }o--|| collection : "belongs to (optional)"
    note }o--|| document_type : "classified as (optional)"

    attachment }o--|| attachment_blob : "content via"
    attachment }o--|| document_type : "typed as (optional)"

    note_skos_tag }o--|| skos_concept : "tagged with"
    skos_concept }o--|| skos_scheme : "belongs to"
    skos_concept ||--o{ skos_concept_relation : "source"
    skos_concept ||--o{ skos_concept_relation : "target"

    embedding_set ||--o{ embedding_set_member : "contains"
    embedding_set_member }o--|| note : "member note"

    note_revision ||--o{ provenance_edge : "has provenance"

    collection ||--o{ collection : "parent of (hierarchy)"
```

---

## 2. Core Notes Model

```mermaid
erDiagram
    note {
        uuid id PK "UUIDv7"
        uuid collection_id FK "nullable"
        text format "markdown | plain | html"
        text source "user | api | email | import"
        timestamptz created_at_utc
        timestamptz updated_at_utc
        boolean starred
        boolean archived
        text title "nullable — AI generated or extracted"
        jsonb metadata "extensible key-value"
        uuid document_type_id FK "nullable"
        text visibility "private | shared | internal | public"
        timestamptz deleted_at "nullable — soft delete"
    }

    note_original {
        uuid note_id PK FK
        text content "immutable original user input"
        text hash "SHA-256 of content"
        timestamptz user_created_at "nullable"
        timestamptz user_last_edited_at "nullable"
    }

    note_revised_current {
        uuid note_id PK FK
        text content "AI-enhanced working version"
        uuid last_revision_id FK "nullable → note_revision"
        jsonb ai_metadata "model, confidence, params"
        timestamptz ai_generated_at "nullable"
        boolean is_user_edited
        int generation_count
        text model "nullable — e.g. llama3.2"
        tsvector tsv "GENERATED — FTS index on content"
    }

    note_revision {
        uuid id PK "UUIDv7"
        uuid note_id FK
        uuid parent_revision_id FK "nullable — chain"
        int revision_number
        text content
        text type "ai_enhancement | user_edit | ..."
        text summary "nullable"
        text rationale "nullable"
        timestamptz created_at_utc
        timestamptz ai_generated_at "nullable"
        boolean is_user_edited
        int generation_count
        text model "nullable"
    }

    note ||--|| note_original : "note_id"
    note ||--o| note_revised_current : "note_id"
    note ||--o{ note_revision : "note_id"
    note_revised_current }o--o| note_revision : "last_revision_id"
    note_revision }o--o| note_revision : "parent_revision_id (chain)"
```

---

## 3. SKOS Knowledge Graph

```mermaid
erDiagram
    skos_scheme {
        uuid id PK "UUIDv7"
        text name "UNIQUE — e.g. topics, programming"
        text description "nullable"
        timestamptz created_at
    }

    skos_concept {
        uuid id PK "UUIDv7"
        uuid scheme_id FK
        text notation "identifier within scheme — e.g. programming/rust"
        text pref_label "preferred display name"
        text definition "nullable"
        timestamptz created_at
    }

    skos_concept_relation {
        uuid source_id FK "PK part"
        uuid target_id FK "PK part"
        text relation_type "broader | narrower | related"
        float strength "confidence / weight"
    }

    note_tag {
        uuid note_id FK "PK part"
        text tag_name "PK part — free-form tag"
        text source "manual | auto | extraction"
    }

    note_skos_tag {
        uuid note_id FK "PK part"
        uuid concept_id FK "PK part"
        text source "manual | auto | extraction"
        float confidence
        float relevance_score
        boolean is_primary
    }

    skos_scheme ||--o{ skos_concept : "scheme_id"
    skos_concept ||--o{ skos_concept_relation : "source_id"
    skos_concept ||--o{ skos_concept_relation : "target_id"
    skos_concept ||--o{ note_skos_tag : "concept_id"
    note ||--o{ note_tag : "note_id"
    note ||--o{ note_skos_tag : "note_id"
```

---

## 4. Search & Embeddings Model

```mermaid
erDiagram
    embedding {
        uuid id PK
        uuid note_id FK
        int chunk_index "sequence within note"
        text text "chunk content"
        vector_768 vector "Float32[768] — pgvector column"
        text model "nomic-embed-text | bge-m3 | ..."
        timestamptz created_at
    }

    embedding_set {
        uuid id PK
        text name "UNIQUE"
        text description "nullable"
        text type "filter | full"
        text mode "auto | manual | mixed"
        jsonb criteria "auto-membership rules"
        jsonb auto_embed_rules
        jsonb document_composition "title/content/tags/concepts to embed"
        text model "nullable — for full type only"
        text index_status "empty | pending | building | ready | stale | disabled"
        jsonb config "MRL settings, two-stage params"
        timestamptz created_at
    }

    embedding_set_member {
        uuid set_id FK "PK part"
        uuid note_id FK "PK part"
        timestamptz added_at
    }

    link {
        uuid id PK
        uuid from_note_id FK
        uuid to_note_id FK "nullable (exclusive with to_url)"
        text to_url "nullable"
        text kind "semantic | manual | reference | cite"
        real score "BM25 or vector similarity"
        timestamptz created_at_utc
        jsonb metadata
    }

    note ||--o{ embedding : "note_id"
    embedding_set ||--o{ embedding_set_member : "set_id"
    note ||--o{ embedding_set_member : "note_id"
    note ||--o{ link : "from_note_id"
    note ||--o{ link : "to_note_id"
```

**HNSW Index** (created in migration):
```sql
CREATE INDEX ON embedding USING hnsw (vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

---

## 5. File Attachments Model

```mermaid
erDiagram
    attachment {
        uuid id PK "UUIDv7"
        uuid note_id FK
        uuid blob_id FK "→ attachment_blob"
        text filename
        text original_filename "nullable"
        uuid document_type_id FK "nullable"
        text extraction_strategy "text_native | pdf_text | pdf_ocr | pandoc | vision | audio_transcribe | video_multimodal | structured_data | code_analysis | none"
        text extracted_text "nullable — indexed for FTS"
        jsonb extracted_metadata "EXIF, dimensions, duration, pages ..."
        text ai_description "nullable — AI caption"
        text status "uploaded | queued | processing | completed | failed | quarantined"
        boolean is_canonical_content "file IS the note (e.g. video)"
        timestamptz created_at
        timestamptz updated_at
    }

    attachment_blob {
        uuid id PK "UUIDv7"
        text content_hash "UNIQUE — blake3:... hex"
        text content_type "MIME type"
        bigint size_bytes
        text storage_backend "filesystem | database"
        text storage_path "blobs/01/94/uuid.bin (for filesystem)"
        bytea data "nullable — inline for files le 10MB"
        int reference_count "GC tracking"
        timestamptz created_at
    }

    document_type {
        uuid id PK
        text name
        text slug "UNIQUE — api identifier"
        text description "nullable"
        text category "general | technical | research | agentic | media"
        text chunking_strategy "semantic | paragraph | sentence | sliding | syntactic"
        int chunk_size
        text extraction_strategy
        jsonb agentic_config "nullable"
        boolean requires_file_attachment
        boolean auto_create_note
        text note_template "nullable"
        text embedding_model_override "nullable"
    }

    attachment ||--|| attachment_blob : "blob_id"
    attachment }o--o| document_type : "document_type_id"
    note }o--o| document_type : "document_type_id"
    note ||--o{ attachment : "note_id"
```

**Two-tier blob storage strategy:**
```
size_bytes <= 10MB  →  attachment_blob.data (BYTEA inline in PGlite)
size_bytes  > 10MB  →  attachment_blob.storage_path (raw OPFS file handle)
                        path: blobs/{first2ofUUID}/{next2ofUUID}/{uuid}.bin
```

---

## 6. Job Queue Model

```mermaid
erDiagram
    job_queue {
        uuid id PK "UUIDv7"
        uuid note_id FK
        text job_type "embedding | ai_revision | concept_tagging | title_generation | linking | extraction | audio_transcription | vision | ..."
        text status "pending | running | completed | failed | cancelled"
        int priority "0=highest, 5=default, 8=low"
        jsonb payload "job-specific config"
        jsonb result "nullable — output"
        text error_message "nullable"
        int progress_percent
        timestamptz created_at
        timestamptz started_at "nullable"
        timestamptz completed_at "nullable"
        int retry_count
        int max_retries
        text required_capability "nullable — semantic | llm | audio | vision"
    }

    note ||--o{ job_queue : "note_id"
```

**Priority assignments:**
```
TitleGeneration:     2   (fast, high value)
Linking:             3   (moderate cost)
Embedding:           5   (default)
ConceptTagging:      5   (chains from AiRevision)
MetadataExtraction:  5
AiRevision:          8   (expensive, lower priority)
```

---

## 7. Provenance & Access Control

```mermaid
erDiagram
    provenance_edge {
        uuid id PK
        uuid revision_id FK "→ note_revision"
        uuid source_note_id FK "nullable (exclusive with source_url)"
        text source_url "nullable"
        text relation "cited_by | influenced_by | derived_from"
        timestamptz created_at_utc
    }

    collection {
        uuid id PK
        text name "UNIQUE"
        text description "nullable"
        uuid parent_id FK "nullable — self-referencing hierarchy"
        timestamptz created_at_utc
    }

    archive {
        uuid id PK
        text name "UNIQUE — e.g. public, work, research"
        text db_path "opfs://fortemi-{name}"
        int max_notes "nullable"
        timestamptz created_at
        int schema_version "current migration version"
    }

    api_key {
        uuid id PK "UUIDv7"
        text key_hash "hashed — never stored plain"
        text name "user label"
        text scopes "read | write | admin"
        timestamptz created_at
        timestamptz expires_at "nullable"
        timestamptz last_used_at "nullable"
    }

    note_revision ||--o{ provenance_edge : "revision_id"
    note ||--o{ provenance_edge : "source_note_id"
    collection ||--o{ collection : "parent_id (self)"
    note }o--o| collection : "collection_id"
```

---

## 8. Complete Table Inventory

| Table | Purpose | Key columns |
|---|---|---|
| `note` | Core note metadata | id (UUIDv7), format, source, visibility, deleted_at |
| `note_original` | Immutable original content | note_id (PK/FK), content, hash |
| `note_revised_current` | AI-enhanced working copy | note_id (PK/FK), content, tsv (GENERATED) |
| `note_revision` | Version history chain | id, note_id, parent_revision_id, revision_number |
| `attachment` | File metadata | id, note_id, blob_id, extraction_strategy, status |
| `attachment_blob` | Content-addressable file store | id, content_hash (UNIQUE), storage_backend, data |
| `embedding` | Vector chunks | id, note_id, chunk_index, vector(768), model |
| `embedding_set` | Named search collections | id, name, type (filter/full), mode, index_status |
| `embedding_set_member` | Set membership | set_id, note_id |
| `skos_scheme` | Tag namespace | id, name |
| `skos_concept` | Hierarchical tag | id, scheme_id, notation, pref_label |
| `skos_concept_relation` | Broader/narrower/related | source_id, target_id, relation_type, strength |
| `note_tag` | Free-form tags | note_id, tag_name, source |
| `note_skos_tag` | SKOS concept tags | note_id, concept_id, confidence, is_primary |
| `link` | Note-to-note connections | id, from_note_id, to_note_id, kind, score |
| `provenance_edge` | W3C PROV derivation | id, revision_id, source_note_id, relation |
| `collection` | Folder hierarchy | id, name, parent_id (self-ref) |
| `archive` | Memory isolation registry | id, name, db_path, schema_version |
| `job_queue` | Async processing pipeline | id, note_id, job_type, status, priority |
| `document_type` | Content type catalog | id, slug, extraction_strategy (seeded) |
| `api_key` | API authentication | id, key_hash, scopes, expires_at |
