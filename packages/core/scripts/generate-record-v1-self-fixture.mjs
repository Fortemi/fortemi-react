#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import {
  MemoryRecordStore,
  exportShardFromRecordsWithReport,
  importShardToRecords,
  packTarGz,
  unpackTarGz,
  validateRecordV1ShardArchive,
} from '../dist/index.js'

const FIXED_NOW = Date.parse('2026-07-26T18:10:00.000Z')
const output = new URL(
  '../src/__tests__/shard/fixtures/recordstore-record-v1-2026.7.13.shard',
  import.meta.url,
)
const verify = process.argv.includes('--verify')
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function seedStore() {
  const store = new MemoryRecordStore()
  const active = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77a'
  const tombstone = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77f'
  const parent = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77b'
  const child = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e780'

  await store.put('collection', {
    id: parent,
    name: 'Current RecordStore parent',
    description: null,
    parent_id: null,
    created_at: '2026-07-26T16:00:00Z',
    updated_at: '2026-07-26T16:00:00Z',
    deleted_at: null,
  })
  await store.put('collection', {
    id: child,
    name: 'Current RecordStore child',
    description: 'Nested collection',
    parent_id: parent,
    created_at: '2026-07-26T16:01:00Z',
    updated_at: '2026-07-26T16:01:00Z',
    deleted_at: null,
  })
  await store.put('note', {
    id: active,
    archive_id: null,
    title: 'Current RecordStore active note',
    format: 'markdown',
    source: 'recordstore-self-cell',
    visibility: 'private',
    revision_mode: 'standard',
    is_starred: false,
    is_pinned: false,
    is_archived: false,
    created_at: '2026-07-26T16:10:00Z',
    updated_at: '2026-07-26T16:11:00Z',
    deleted_at: null,
  })
  await store.put('note', {
    id: tombstone,
    archive_id: null,
    title: 'Current RecordStore tombstone',
    format: 'markdown',
    source: 'recordstore-self-cell',
    visibility: 'private',
    revision_mode: 'standard',
    is_starred: false,
    is_pinned: false,
    is_archived: true,
    created_at: '2026-07-26T16:12:00Z',
    updated_at: '2026-07-26T16:13:00Z',
    deleted_at: '2026-07-26T16:14:00Z',
  })
  await store.put('note_original', {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e781',
    note_id: active,
    content: 'Original active RecordStore content',
    content_hash: 'fixture-active-original',
    created_at: '2026-07-26T16:10:00Z',
  })
  await store.put('note_original', {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e782',
    note_id: tombstone,
    content: 'Original tombstone RecordStore content',
    content_hash: 'fixture-tombstone-original',
    created_at: '2026-07-26T16:12:00Z',
  })
  await store.put('note_revised_current', {
    id: active,
    content: 'Revised active RecordStore content',
    ai_metadata: {
      conformance: {
        producer: '@fortemi/core',
        profile: 'record-v1',
        version: '2026.7.13',
      },
    },
    generation_count: 1,
    model: 'fixture',
    is_user_edited: false,
    updated_at: '2026-07-26T16:11:00Z',
  })
  await store.put('note_revised_current', {
    id: tombstone,
    content: null,
    ai_metadata: null,
    generation_count: 0,
    model: null,
    is_user_edited: false,
    updated_at: '2026-07-26T16:13:00Z',
  })
  await store.put('note_tag', {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e783',
    note_id: active,
    tag: 'record-receipt',
    created_at: '2026-07-26T16:10:00Z',
  })
  await store.put('link', {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77e',
    source_note_id: active,
    target_note_id: tombstone,
    link_type: 'related',
    created_at: '2026-07-26T16:12:00Z',
    deleted_at: null,
  })
  await store.put('collection_note', {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e784',
    collection_id: child,
    note_id: active,
    created_at: '2026-07-26T16:10:30Z',
  })
  await store.put('attachment_blob', {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77d',
    content_hash: `blake3:${'0123456789abcdef'.repeat(4)}`,
    size_bytes: 7,
    created_at: '2026-07-26T16:10:20Z',
  })
  await store.put('attachment', {
    id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77c',
    note_id: active,
    blob_id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77d',
    document_type_id: null,
    mime_type: 'application/octet-stream',
    extracted_text: null,
    filename: 'recordstore-receipt.bin',
    display_name: null,
    position: 0,
    created_at: '2026-07-26T16:10:20Z',
    deleted_at: null,
  })

  return { store, active, tombstone, parent, child }
}

async function assertEmptyRejected(archive, pattern) {
  const destination = new MemoryRecordStore()
  try {
    const result = await importShardToRecords(destination, archive, {
      conflictStrategy: 'replace',
    })
    assert.equal(result.success, false)
    assert.match(result.errors.join('\n'), pattern)
    assert.equal(await destination.headSeq(), 0)
    assert.deepEqual(await destination.list('note'), [])
    assert.deepEqual(await destination.list('collection'), [])
  } finally {
    await destination.close()
  }
}

const NativeDate = Date
class FrozenDate extends NativeDate {
  constructor(...args) {
    super(...(args.length === 0 ? [FIXED_NOW] : args))
  }

  static now() {
    return FIXED_NOW
  }
}

globalThis.Date = FrozenDate
const source = await seedStore()
try {
  const exported = await exportShardFromRecordsWithReport(source.store, {
    profile: 'record-v1',
  })
  assert.equal(exported.success, true, exported.errors.join('; '))
  assert.ok(exported.archive)
  assert.equal(exported.capability_report.portable, true)
  assert.deepEqual(
    exported.capability_report.losses.map((loss) => loss.code),
    [
      'null-revised-content-normalized',
      'attachment-lifecycle-outside-profile',
      'link-confidence-defaulted',
    ],
  )
  assert.deepEqual(await validateRecordV1ShardArchive(exported.archive), {
    valid: true,
    errors: [],
  })

  const repeated = await exportShardFromRecordsWithReport(source.store, {
    profile: 'record-v1',
  })
  assert.equal(Buffer.compare(Buffer.from(exported.archive), Buffer.from(repeated.archive)), 0)

  const files = unpackTarGz(exported.archive)
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')))
  assert.deepEqual(manifest.counts, {
    notes: 2,
    collections: 2,
    tags: 1,
    templates: 0,
    links: 1,
    embedding_sets: 0,
    embedding_set_members: 0,
    embeddings: 0,
    embedding_configs: 0,
  })
  const collections = JSON.parse(decoder.decode(files.get('collections.json')))
  assert.equal(
    collections.find((collection) => collection.id === source.child)?.parent_id,
    source.parent,
  )

  const destination = new MemoryRecordStore()
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const imported = await importShardToRecords(destination, exported.archive, {
        conflictStrategy: 'replace',
      })
      assert.equal(imported.success, true, imported.errors.join('; '))
    }
    assert.equal(
      (await destination.get('collection', source.child))?.parent_id,
      source.parent,
    )
    assert.equal(
      (await destination.get('note', source.tombstone))?.deleted_at,
      '2026-07-26T16:14:00Z',
    )

    const reexported = await exportShardFromRecordsWithReport(destination, {
      profile: 'record-v1',
    })
    assert.equal(reexported.success, true, reexported.errors.join('; '))
    const reexportedFiles = unpackTarGz(reexported.archive)
    for (const component of [
      'notes.jsonl',
      'collections.json',
      'tags.json',
      'links.jsonl',
    ]) {
      assert.equal(
        decoder.decode(reexportedFiles.get(component)),
        decoder.decode(files.get(component)),
      )
    }
  } finally {
    await destination.close()
  }

  await assertEmptyRejected(
    new Uint8Array([0x6e, 0x6f, 0x74, 0x2d, 0x67, 0x7a]),
    /decompress/i,
  )

  const nextMajorFiles = new Map(files)
  nextMajorFiles.set(
    'manifest.json',
    encoder.encode(JSON.stringify({
      ...manifest,
      version: '3.0.0',
      min_reader_version: '3.0.0',
    })),
  )
  await assertEmptyRejected(
    packTarGz(nextMajorFiles),
    /unsupported canonical record-v1 schema version|reader version/i,
  )

  const cycleFiles = new Map(files)
  const cycleCollections = collections.map((collection) =>
    collection.id === source.child
      ? { ...collection, parent_id: source.child }
      : collection)
  const cycleCollectionBytes = encoder.encode(JSON.stringify(cycleCollections))
  cycleFiles.set('collections.json', cycleCollectionBytes)
  cycleFiles.set(
    'manifest.json',
    encoder.encode(JSON.stringify({
      ...manifest,
      checksums: {
        ...manifest.checksums,
        'collections.json': sha256(cycleCollectionBytes),
      },
    })),
  )
  await assertEmptyRejected(packTarGz(cycleFiles), /hierarchy contains a cycle/i)

  const oversized = new Uint8Array(exported.archive)
  new DataView(oversized.buffer, oversized.byteOffset, oversized.byteLength)
    .setUint32(oversized.byteLength - 4, 256 * 1024 * 1024 + 1, true)
  await assertEmptyRejected(oversized, /declared size.*exceeds cap/i)

  const oldestSupportedFiles = new Map(files)
  oldestSupportedFiles.set(
    'manifest.json',
    encoder.encode(JSON.stringify({
      ...manifest,
      version: '1.1.0',
      min_reader_version: '1.1.0',
    })),
  )
  const legacyDestination = new MemoryRecordStore()
  try {
    const legacy = await importShardToRecords(
      legacyDestination,
      packTarGz(oldestSupportedFiles),
      { conflictStrategy: 'replace' },
    )
    assert.equal(legacy.success, true, legacy.errors.join('; '))
    assert.equal(legacy.capability_report.requested_profile, 'record-v1')
    assert.equal(
      (await legacyDestination.get('collection', source.child))?.parent_id,
      source.parent,
    )
  } finally {
    await legacyDestination.close()
  }

  const undefinedV1Files = new Map(files)
  undefinedV1Files.set(
    'manifest.json',
    encoder.encode(JSON.stringify({
      ...manifest,
      version: '1.0.0',
      min_reader_version: '1.0.0',
    })),
  )
  await assertEmptyRejected(
    packTarGz(undefinedV1Files),
    /unsupported canonical record-v1 schema version/i,
  )

  if (verify) {
    const expected = await readFile(output)
    assert.equal(
      Buffer.compare(Buffer.from(exported.archive), expected),
      0,
      `fixture drift: expected ${sha256(expected)}, got ${sha256(exported.archive)}`,
    )
  } else {
    await writeFile(output, exported.archive)
  }
  process.stdout.write(`${sha256(exported.archive)}  ${output.pathname}\n`)
} finally {
  await source.store.close()
  globalThis.Date = NativeDate
}
