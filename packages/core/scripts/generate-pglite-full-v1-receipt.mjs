import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { packTarGz, unpackTarGz, validateFullV1ShardArchive } from '../dist/index.js'

const root = new URL('../', import.meta.url)
const sourcePath = new URL('src/__tests__/shard/fixtures/full-v1/server-full-v1-revision-19.shard', root)
const archivePath = new URL('src/__tests__/shard/fixtures/full-v1/server-full-v1-revision-19-v2.shard', root)
const receiptPath = new URL('schemas/knowledge-shard-v2.implementation.receipt.json', root)
const implementationPaths = [
  'scripts/generate-pglite-full-v1-receipt.mjs',
  'src/shard/full-v1-store.ts',
  'src/shard/live-full-v1.ts',
  'src/shard/schema-validator.ts',
  'src/shard/full-v1-references.ts',
  'src/shard/native-note-history.ts',
  'src/shard/native-embeddings.ts',
  'src/shard/native-fields.ts',
  'src/shard/native-skos.ts',
  'src/shard/native-provenance.ts',
  'src/shard/native-graph.ts',
  'src/shard/native-core.ts',
  'src/shard/native-geometry.ts',
  'src/shard/geometry-buffer.ts',
  'src/shard/geometry-util.js',
  'tsup.config.ts',
  'package.json',
  'src/shard/shard-import.ts',
  'src/shard/shard-export.ts',
  'src/shard/profile-registry.ts',
  'src/shard/shard-signature.ts',
  'src/shard/blob-staging.ts',
  'src/migrations/0020_full_v1_snapshot.ts',
  'src/migrations/0022_embedding_config_timestamps.ts',
  'src/migrations/0023_source_metadata_purge.ts',
  'src/migrations/0025_native_note_history.ts',
  'src/migrations/0026_native_embeddings.ts',
  'src/migrations/0027_native_skos.ts',
  'src/migrations/0028_native_provenance.ts',
  'src/migrations/0029_native_graph.ts',
  'src/migrations/0030_native_core.ts',
  'src/migrations/index.ts',
  'src/repositories/notes-repository.ts',
  'src/repositories/embedding-sets-repository.ts',
  'src/repositories/skos-repository.ts',
  'src/repositories/provenance-repository.ts',
  'src/repositories/graph-repository.ts',
  'src/repositories/communities-repository.ts',
  'src/repositories/collections-repository.ts',
  'src/repositories/tags-repository.ts',
  'src/repositories/templates-repository.ts',
  'src/repositories/links-repository.ts',
  'src/repositories/metadata-predicates.ts',
  'src/data-backend.ts',
  'src/repositories/search-repository.ts',
  'src/repositories/source-upsert-repository.ts',
  'src/repositories/types.ts',
  'src/records/record-projection.ts',
  'src/job-queue-worker.ts',
  'src/index.ts',
  'src/__tests__/shard/full-v1-store.test.ts',
  'src/__tests__/shard/full-v1-public.test.ts',
  'src/__tests__/shard/full-v1-references.test.ts',
  'src/__tests__/shard/native-note-history.test.ts',
  'src/__tests__/shard/native-embeddings.test.ts',
  'src/__tests__/shard/native-skos.test.ts',
  'src/__tests__/shard/native-provenance.test.ts',
  'src/__tests__/shard/native-graph.test.ts',
  'src/__tests__/shard/native-core.test.ts',
  'src/__tests__/storage-backend.test.ts',
  'src/__tests__/shard/native-geometry.test.ts',
  'src/__tests__/db-table-parity/db-table-parity.test.ts',
  'src/__tests__/shard/fixtures/full-v1/reference-conformance.json',
  'src/__tests__/shard/fixtures/full-v1/reference-conformance.receipt.json',
  'schemas/knowledge-shard-v2.schema.receipt.json',
]
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

const sourceBytes = await readFile(sourcePath)
const files = unpackTarGz(sourceBytes)
const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
manifest.version = '2.0.0'
manifest.min_reader_version = '2.0.0'
files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)))
// The source publisher signature commits to the original manifest bytes.
// A schema-version rewrite must never retain that now-invalid envelope.
files.delete('signature.json')
const validation = await validateFullV1ShardArchive(files)
if (!validation.valid) throw new Error(validation.errors.join('; '))
const archive = packTarGz(files)
await writeFile(archivePath, archive)

const implementation = {}
for (const path of implementationPaths) {
  implementation[path] = digest(await readFile(new URL(path, root)))
}
await writeFile(receiptPath, `${JSON.stringify({
  schemaVersion: 1,
  status: 'local-conformance-passed',
  tuple: { schemaVersion: '2.0.0', profile: 'full-v1' },
  authority: {
    repository: 'https://git.integrolabs.net/Fortemi/fortemi',
    commit: '6343bd899958445bbc7e7e87b0dc92a8429d5a06',
    contractSha256: '5bf8d2fd8147d8df92599b1a3ce6b405ce022c83893f37547aefa7ca659f0783',
    schemaBundleSha256: '66dee80876c73fdc8756541c72e96ae189c098113a831c849d619381c4121c02',
  },
  sourceFixture: {
    path: 'src/__tests__/shard/fixtures/full-v1/server-full-v1-revision-19.shard',
    sha256: digest(sourceBytes),
  },
  archive: {
    path: 'src/__tests__/shard/fixtures/full-v1/server-full-v1-revision-19-v2.shard',
    bytes: archive.byteLength,
    sha256: digest(archive),
  },
  implementation,
  evidence: {
    command: 'pnpm --filter @fortemi/core test:portable-contract',
    assertions: [
      'all-33-components-persisted',
      'all-33-components-produced-from-live-pglite',
      'live-domain-relationships-materialized',
      'stable-live-identities-and-timestamps',
      'mandatory-blobs-reference-counted',
      'missing-live-blob-rejected',
      'invalid-source-signature-removed-after-manifest-rewrite',
      'valid-runtime-signature-retained',
      'live-runtime-signature-produced-and-verified',
      'unrepresentable-live-state-rejected-with-typed-loss',
      'validate-before-mutation',
      'repeat-import-converges',
      'exact-logical-files-reexported',
      'public-archival-api-independent-of-native-state-not-native-restore',
      'producer-owned-relationship-mutations-rejected-before-storage-not-native-restore',
      'internal-native-note-history-stage-and-post-apply-writers-not-public-full-v1-restore',
      'internal-native-embedding-stage-and-mixed-dimension-search-not-public-full-v1-restore',
      'internal-native-skos-ten-component-stage-and-language-projections-not-public-full-v1-restore',
      'internal-native-provenance-six-component-stage-and-browser-geometry-not-public-full-v1-restore',
      'internal-native-graph-four-component-stage-and-stored-community-assignments-not-public-full-v1-restore',
      'internal-native-core-five-component-stage-with-independent-metadata-and-attachments-not-public-full-v1-restore',
    ],
  },
}, null, 2)}\n`)
