import type { AiwgFortemiIndexExport, AiwgFortemiRecord } from './aiwg-index.js'
import { validateAiwgFortemiIndexExport } from './aiwg-index.js'
import { sha256Hex as shardSha256Hex } from './shard/checksum.js'
import { validateCoreV1ShardArchive } from './shard/schema-validator.js'
import { packTarGz, unpackTarGz } from './shard/shard-tar.js'
import {
  CURRENT_SHARD_VERSION,
  SHARD_FORMAT,
  type ShardComponent,
  type ShardLink,
  type ShardManifest,
  type ShardNote,
} from './shard/types.js'
import { v5 as uuidv5 } from 'uuid'
import {
  convertAiwgIndexToFullV1,
  type AiwgFullV1ConversionResult,
} from './aiwg-index-full-shard.js'

export interface AiwgKnowledgeShardOptions {
  createdAt?: string
  matricVersion?: string
  /** Use the report-bearing entry point for rich conversion. */
  includeNativeRichComponents?: boolean
}

export type AiwgKnowledgeShardConversionResult = AiwgFullV1ConversionResult

const AIWG_SHARD_UUID_NAMESPACE = '7ab5d1f8-29d2-5e35-9e2f-3a45de171a9e'
const shardEncoder = new TextEncoder()
const shardDecoder = new TextDecoder()

function aiwgShardUuid(kind: string, id: string): string {
  return uuidv5(`${kind}:${id}`, AIWG_SHARD_UUID_NAMESPACE)
}

function aiwgShardTimestamp(value: string | undefined, fallback: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return fallback
  return new Date(value).toISOString()
}

function aiwgRecordTitle(record: AiwgFortemiRecord): string {
  return record.title ?? record.search?.title ?? record.search?.name ?? record.id
}

function aiwgRecordContent(record: AiwgFortemiRecord): string {
  if (record.text) return record.text
  if (record.search?.body) return record.search.body
  const chunks = record.chunks
    ?.map((chunk) => chunk.text ?? chunk.body ?? chunk.summary ?? '')
    .filter(Boolean)
  if (chunks?.length) return chunks.join('\n\n')
  return record.search?.summary ?? ''
}

function aiwgShardMetadata(
  index: AiwgFortemiIndexExport,
  record: AiwgFortemiRecord,
): Record<string, unknown> {
  return {
    aiwg_fortemi_index: {
      envelope: {
        schema_version: index.schema_version,
        generated_at: index.generated_at,
        source: index.source,
        ...(index.compatibility ? { compatibility: index.compatibility } : {}),
      },
      record,
    },
  }
}

function encodeJsonLines(values: unknown[]): Uint8Array {
  return shardEncoder.encode(values.map((value) => JSON.stringify(value)).join('\n'))
}

/**
 * Convert the static AIWG/Fortemi v2 index contract into a portable Knowledge
 * Shard. Every note retains the complete source envelope and record in metadata,
 * so the native note/link/SKOS/provenance projections are reversible.
 */
export async function aiwgFortemiIndexToKnowledgeShard(
  index: AiwgFortemiIndexExport,
  options: AiwgKnowledgeShardOptions = {},
): Promise<Uint8Array> {
  if (options.includeNativeRichComponents) {
    throw new Error(
      'Native AIWG full-v1 conversion requires aiwgFortemiIndexToKnowledgeShardWithReport so semantic losses cannot be discarded',
    )
  }
  const validation = validateAiwgFortemiIndexExport(index)
  if (!validation.valid) {
    throw new Error(`Invalid AIWG Fortemi index export:\n${validation.errors.join('\n')}`)
  }
  if (index.schema_version !== 'aiwg.fortemi.index.export.v2') {
    throw new Error('Knowledge Shard conversion requires aiwg.fortemi.index.export.v2')
  }
  const createdAt = aiwgShardTimestamp(options.createdAt ?? index.generated_at, new Date().toISOString())
  const noteIds = new Map(index.items.map((record) => [record.id, aiwgShardUuid('record', record.id)]))
  const notes: ShardNote[] = index.items.map((record) => {
    const content = aiwgRecordContent(record)
    return {
      id: noteIds.get(record.id)!,
      title: aiwgRecordTitle(record),
      original_content: content,
      revised_content: content,
      metadata: aiwgShardMetadata(index, record),
      collection_id: null,
      attachments: [],
      format: 'markdown',
      source: 'aiwg-index',
      starred: false,
      archived: false,
      tags: [...new Set(record.tags)].sort(),
      created_at: aiwgShardTimestamp(record.source.updated_at ?? record.updated_at, createdAt),
      updated_at: aiwgShardTimestamp(record.updated_at, createdAt),
      deleted_at: null,
    }
  })

  const links: ShardLink[] = []
  for (const record of index.items) {
    for (const [position, relationship] of record.relationships.entries()) {
      const targetNoteId = noteIds.get(relationship.target_id) ?? null
      links.push({
        id: aiwgShardUuid(
          'relationship',
          `${record.id}\u0000${position}\u0000${relationship.type}\u0000${relationship.target_id}`,
        ),
        from_note_id: noteIds.get(record.id)!,
        to_note_id: targetNoteId,
        to_url: targetNoteId ? null : `aiwg://record/${encodeURIComponent(relationship.target_id)}`,
        kind: relationship.type,
        score: relationship.confidence ?? 1,
        created_at: aiwgShardTimestamp(record.updated_at, createdAt),
        metadata: {
          aiwg_fortemi_index: {
            source_record_id: record.id,
            target_record_id: relationship.target_id,
            relationship,
          },
        },
      })
    }
  }

  const files = new Map<string, Uint8Array>()
  const components: ShardComponent[] = ['notes', 'tags']
  const counts: ShardManifest['counts'] = {
    notes: notes.length,
    tags: [...new Set(notes.flatMap((note) => note.tags))].length,
  }
  files.set('notes.jsonl', encodeJsonLines(notes))
  files.set('tags.json', shardEncoder.encode(JSON.stringify(
    [...new Set(notes.flatMap((note) => note.tags))]
      .sort()
      .map((name) => ({ name, created_at: createdAt })),
  )))

  const addComponent = (
    component: ShardComponent,
    filename: string,
    values: unknown[],
    jsonLines = true,
  ) => {
    if (values.length === 0) return
    components.push(component)
    counts[component] = values.length
    files.set(filename, jsonLines ? encodeJsonLines(values) : shardEncoder.encode(JSON.stringify(values)))
  }
  addComponent('links', 'links.jsonl', links)

  const checksums: Record<string, string> = {}
  for (const [filename, bytes] of files) checksums[filename] = await shardSha256Hex(bytes)
  const manifest: ShardManifest = {
    version: CURRENT_SHARD_VERSION,
    profile: 'core-v1',
    producer: {
      name: 'fortemi-core-aiwg-index',
      version: options.matricVersion ?? 'fortemi-core',
    },
    format: SHARD_FORMAT,
    created_at: createdAt,
    components,
    counts: {
      notes: 0,
      collections: 0,
      tags: 0,
      templates: 0,
      links: 0,
      embedding_sets: 0,
      embedding_set_members: 0,
      embeddings: 0,
      embedding_configs: 0,
      ...counts,
    },
    checksums,
    min_reader_version: CURRENT_SHARD_VERSION,
  }
  files.set('manifest.json', shardEncoder.encode(JSON.stringify(manifest, null, 2)))
  const contractValidation = await validateCoreV1ShardArchive(files)
  if (!contractValidation.valid) {
    throw new Error(
      `Generated AIWG core-v1 shard failed canonical validation: ${contractValidation.errors.join('; ')}`,
    )
  }
  return packTarGz(files)
}

/** Convert AIWG v2 into exact 2.0.0/full-v1 with mandatory loss evidence. */
export async function aiwgFortemiIndexToKnowledgeShardWithReport(
  index: AiwgFortemiIndexExport,
  options: Omit<AiwgKnowledgeShardOptions, 'includeNativeRichComponents'> = {},
): Promise<AiwgKnowledgeShardConversionResult> {
  const validation = validateAiwgFortemiIndexExport(index)
  if (!validation.valid) {
    throw new Error(`Invalid AIWG Fortemi index export:\n${validation.errors.join('\n')}`)
  }
  if (index.schema_version !== 'aiwg.fortemi.index.export.v2') {
    throw new Error('Full-v1 Knowledge Shard conversion requires aiwg.fortemi.index.export.v2')
  }
  return convertAiwgIndexToFullV1(index, options)
}

/**
 * Recover the exact AIWG index envelope and records embedded by
 * {@link aiwgFortemiIndexToKnowledgeShard}.
 */
export function aiwgFortemiIndexFromKnowledgeShard(bytes: Uint8Array): AiwgFortemiIndexExport {
  const files = unpackTarGz(bytes)
  const noteBytes = files.get('notes.jsonl')
  const notes = (noteBytes ? shardDecoder.decode(noteBytes) : '')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ShardNote)
  if (notes.length === 0) throw new Error('Knowledge Shard contains no AIWG index notes')

  let envelope: Record<string, unknown> | undefined
  const items: AiwgFortemiRecord[] = []
  for (const note of notes) {
    const metadata = note.metadata?.aiwg_fortemi_index
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error(`Knowledge Shard note ${note.id} has no AIWG index metadata`)
    }
    const value = metadata as Record<string, unknown>
    envelope ??= value.envelope as Record<string, unknown>
    items.push(value.record as AiwgFortemiRecord)
  }
  const restored = {
    ...envelope,
    items: items.sort((left, right) => left.id.localeCompare(right.id)),
  } as unknown as AiwgFortemiIndexExport
  const validation = validateAiwgFortemiIndexExport(restored)
  if (!validation.valid) {
    throw new Error(`Knowledge Shard contains invalid AIWG index metadata:\n${validation.errors.join('\n')}`)
  }
  return restored
}
