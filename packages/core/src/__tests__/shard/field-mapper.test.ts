import { describe, it, expect } from 'vitest'
import {
  noteToShard,
  noteFromShard,
  linkToShard,
  linkFromShard,
  collectionToShard,
  collectionFromShard,
  tagsToShard,
  tagsFromShard,
  embeddingSetToShard,
  embeddingSetFromShard,
  embeddingToShard,
  embeddingFromShard,
} from '../../shard/field-mapper.js'
import type { BrowserNoteExport } from '../../shard/field-mapper.js'
import type { LinkRow } from '../../repositories/links-repository.js'
import type { CollectionRow } from '../../repositories/collections-repository.js'

describe('field-mapper: notes', () => {
  const browserNote: BrowserNoteExport = {
    id: 'note-1',
    title: 'Test Note',
    format: 'markdown',
    source: 'manual',
    is_starred: true,
    is_archived: false,
    created_at: '2026-01-15T10:00:00.000Z',
    updated_at: '2026-01-16T12:00:00.000Z',
    deleted_at: null,
    original_content: 'Original text',
    revised_content: 'Revised text',
    tags: ['science', 'physics'],
  }

  it('renames is_starred → starred', () => {
    const shard = noteToShard(browserNote)
    expect(shard.starred).toBe(true)
    expect(shard).not.toHaveProperty('is_starred')
  })

  it('renames is_archived → archived', () => {
    const shard = noteToShard(browserNote)
    expect(shard.archived).toBe(false)
    expect(shard).not.toHaveProperty('is_archived')
  })

  it('joins original_content and revised_content at top level', () => {
    const shard = noteToShard(browserNote)
    expect(shard.original_content).toBe('Original text')
    expect(shard.revised_content).toBe('Revised text')
  })

  it('preserves tags array', () => {
    const shard = noteToShard(browserNote)
    expect(shard.tags).toEqual(['science', 'physics'])
  })

  it('round-trips: browser → shard → browser produces identical data', () => {
    const shard = noteToShard(browserNote)
    const roundTripped = noteFromShard(shard)
    expect(roundTripped).toEqual(browserNote)
  })

  it('handles Date objects for timestamps', () => {
    const noteWithDates = {
      ...browserNote,
      created_at: new Date('2026-01-15T10:00:00.000Z'),
      updated_at: new Date('2026-01-16T12:00:00.000Z'),
    }
    const shard = noteToShard(noteWithDates)
    expect(shard.created_at).toBe('2026-01-15T10:00:00.000Z')
    expect(shard.updated_at).toBe('2026-01-16T12:00:00.000Z')
  })

  it('handles null deleted_at', () => {
    const shard = noteToShard(browserNote)
    expect(shard.deleted_at).toBeNull()
  })

  it('handles non-null deleted_at', () => {
    const deleted = { ...browserNote, deleted_at: '2026-02-01T00:00:00.000Z' }
    const shard = noteToShard(deleted)
    expect(shard.deleted_at).toBe('2026-02-01T00:00:00.000Z')
  })
})

describe('field-mapper: links', () => {
  const browserLink: LinkRow = {
    id: 'link-1',
    source_note_id: 'note-a',
    target_note_id: 'note-b',
    link_type: 'related',
    confidence: 0.85,
    created_at: new Date('2026-01-15T10:00:00.000Z'),
    updated_at: null,
    deleted_at: null,
  }

  it('renames source_note_id → from_note_id', () => {
    const shard = linkToShard(browserLink)
    expect(shard.from_note_id).toBe('note-a')
    expect(shard).not.toHaveProperty('source_note_id')
  })

  it('renames target_note_id → to_note_id', () => {
    const shard = linkToShard(browserLink)
    expect(shard.to_note_id).toBe('note-b')
    expect(shard).not.toHaveProperty('target_note_id')
  })

  it('renames link_type → kind', () => {
    const shard = linkToShard(browserLink)
    expect(shard.kind).toBe('related')
    expect(shard).not.toHaveProperty('link_type')
  })

  it('renames confidence → score', () => {
    const shard = linkToShard(browserLink)
    expect(shard.score).toBe(0.85)
    expect(shard).not.toHaveProperty('confidence')
  })

  it('round-trips link fields correctly', () => {
    const shard = linkToShard(browserLink)
    const back = linkFromShard(shard)
    expect(back.id).toBe('link-1')
    expect(back.source_note_id).toBe('note-a')
    expect(back.target_note_id).toBe('note-b')
    expect(back.link_type).toBe('related')
    expect(back.confidence).toBe(0.85)
  })

  it('handles null confidence → null score', () => {
    const noConf = { ...browserLink, confidence: null }
    const shard = linkToShard(noConf)
    expect(shard.score).toBeNull()
  })
})

describe('field-mapper: collections', () => {
  const browserCollection: CollectionRow = {
    id: 'col-1',
    name: 'Research',
    description: 'Research papers',
    parent_id: null,
    position: 0,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
  }

  it('maps to shard format', () => {
    const shard = collectionToShard(browserCollection, 5)
    expect(shard.id).toBe('col-1')
    expect(shard.name).toBe('Research')
    expect(shard.note_count).toBe(5)
  })

  it('round-trips core fields', () => {
    const shard = collectionToShard(browserCollection)
    const back = collectionFromShard(shard)
    expect(back.id).toBe('col-1')
    expect(back.name).toBe('Research')
    expect(back.description).toBe('Research papers')
    expect(back.parent_id).toBeNull()
  })
})

describe('field-mapper: tags', () => {
  it('converts to shard tag format', () => {
    const tags = [
      { name: 'physics', created_at: new Date('2026-01-01T00:00:00.000Z') },
      { name: 'math', created_at: new Date('2026-01-02T00:00:00.000Z') },
    ]
    const shard = tagsToShard(tags)
    expect(shard).toHaveLength(2)
    expect(shard[0].name).toBe('physics')
    expect(shard[1].name).toBe('math')
  })

  it('converts from shard tags to unique tag names', () => {
    const shardTags = [
      { name: 'physics', created_at: '2026-01-01T00:00:00.000Z' },
      { name: 'physics', created_at: '2026-01-02T00:00:00.000Z' },
      { name: 'math', created_at: '2026-01-01T00:00:00.000Z' },
    ]
    const names = tagsFromShard(shardTags)
    expect(names).toEqual(['physics', 'math'])
  })
})

describe('field-mapper: embeddings', () => {
  it('renames model_name → model and dimensions → dimension', () => {
    const set = {
      id: 'es-1',
      model_name: 'all-MiniLM-L6-v2',
      dimensions: 384,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    }
    const shard = embeddingSetToShard(set)
    expect(shard.model).toBe('all-MiniLM-L6-v2')
    expect(shard.dimension).toBe(384)
    expect(shard).not.toHaveProperty('model_name')
    expect(shard).not.toHaveProperty('dimensions')
  })

  it('round-trips embedding set fields', () => {
    const set = {
      id: 'es-1',
      model_name: 'all-MiniLM-L6-v2',
      dimensions: 384,
      created_at: '2026-01-01T00:00:00.000Z',
    }
    const shard = embeddingSetToShard(set)
    const back = embeddingSetFromShard(shard)
    expect(back.model_name).toBe('all-MiniLM-L6-v2')
    expect(back.dimensions).toBe(384)
  })

  it('converts PGlite vector string to number array', () => {
    const emb = {
      id: 'emb-1',
      note_id: 'note-1',
      embedding_set_id: 'es-1',
      vector: '[0.1,0.2,0.3]',
      created_at: '2026-01-01T00:00:00.000Z',
    }
    const shard = embeddingToShard(emb)
    expect(shard.vector).toEqual([0.1, 0.2, 0.3])
  })

  it('converts number array back to PGlite vector string', () => {
    const shard = {
      id: 'emb-1',
      note_id: 'note-1',
      embedding_set_id: 'es-1',
      vector: [0.1, 0.2, 0.3],
      created_at: '2026-01-01T00:00:00.000Z',
    }
    const back = embeddingFromShard(shard)
    expect(back.vector).toBe('[0.1,0.2,0.3]')
  })
})
