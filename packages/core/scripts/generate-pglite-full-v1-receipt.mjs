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
  'src/shard/shard-import.ts',
  'src/shard/shard-export.ts',
  'src/shard/profile-registry.ts',
  'src/shard/shard-signature.ts',
  'src/shard/blob-staging.ts',
  'src/migrations/0020_full_v1_snapshot.ts',
  'src/migrations/0022_embedding_config_timestamps.ts',
  'src/migrations/index.ts',
  'src/__tests__/shard/full-v1-store.test.ts',
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
    ],
  },
}, null, 2)}\n`)
