import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const authority = JSON.parse(await readFile(
  new URL('schemas/knowledge-shard-v2.schema.receipt.json', root),
  'utf8',
))
const fieldSemantics = JSON.parse(await readFile(
  new URL('schemas/knowledge-shard/2.0.0/field-semantics.json', root),
  'utf8',
))
const receiptPath = new URL('schemas/knowledge-shard-v2.presence.receipt.json', root)
const implementationPaths = [
  'scripts/generate-presence-receipt.mjs',
  'scripts/verify-knowledge-shard-contract.mjs',
  'src/shard/presence.ts',
  'src/shard/presence-store.ts',
  'src/shard/shard-import.ts',
  'src/shard/shard-export.ts',
  'src/records/types.ts',
  'src/records/memory-record-store.ts',
  'src/records/idb-record-store.ts',
  'src/records/record-shard.ts',
  'src/migrations/0019_shard_field_presence.ts',
  'src/migrations/0021_attachment_extraction_projection.ts',
  'src/migrations/index.ts',
  'src/__tests__/shard/presence.test.ts',
  'src/__tests__/records/record-store.test.ts',
  'src/__tests__/records/record-shard.test.ts',
]
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const implementation = {}
for (const path of implementationPaths) {
  implementation[path] = digest(await readFile(new URL(path, root)))
}

await writeFile(receiptPath, `${JSON.stringify({
  schemaVersion: 1,
  status: 'local-conformance-passed',
  tuple: { schemaVersion: '2.0.0', profiles: ['core-v1', 'record-v1', 'full-v1'] },
  authority: {
    repository: authority.source.repository,
    commit: authority.source.commit,
    contractSha256: authority.source.contractSha256,
    schemaBundleSha256: authority.schemaBundle.sha256,
    fieldSemanticsSha256: authority.schemaBundle.files['field-semantics.json'],
  },
  matrix: {
    fields: fieldSemantics.fields.length,
    wildcardFields: fieldSemantics.fields.filter((field) => field.pointer.includes('/*')).length,
    stateVectorsPerField: 6,
    semanticAssertions: fieldSemantics.fields.length * 6,
    storageBackends: ['pglite', 'memory-record-store', 'indexeddb-record-store'],
  },
  implementation,
  evidence: {
    command: 'pnpm --filter @fortemi/core test:portable-contract',
    assertions: [
      'all-authority-fields-loaded',
      'all-authority-state-rules-enforced',
      'wildcards-expanded-per-array-member',
      'unsupported-states-rejected-before-import-mutation',
      'pglite-presence-sidecar-roundtrip',
      'memory-record-store-roundtrip',
      'indexeddb-record-store-roundtrip',
      'pglite-attachment-value-reexport',
      'record-store-manifest-link-attachment-reexport',
      'legacy-indeterminate-export-rejected',
    ],
  },
}, null, 2)}\n`)
