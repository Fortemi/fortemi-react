import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const receiptPath = resolve(packageRoot, 'schemas/knowledge-shard.schema.receipt.json')
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
const v2ReceiptPath = resolve(packageRoot, 'schemas/knowledge-shard-v2.schema.receipt.json')
const v2Receipt = JSON.parse(readFileSync(v2ReceiptPath, 'utf8'))
const v2ImplementationReceiptPath = resolve(
  packageRoot,
  'schemas/knowledge-shard-v2.implementation.receipt.json',
)
const v2ImplementationReceipt = JSON.parse(readFileSync(v2ImplementationReceiptPath, 'utf8'))

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function verifyBundle(bundle, label) {
  const aggregate = createHash('sha256')
  for (const [relativePath, expected] of Object.entries(bundle.files).sort(([left], [right]) =>
    left.localeCompare(right))) {
    const bytes = readFileSync(resolve(packageRoot, bundle.vendoredRoot, relativePath))
    const actual = sha256(bytes)
    if (actual !== expected) {
      throw new Error(`${label} digest drift: ${relativePath}; expected ${expected}, got ${actual}`)
    }
    aggregate.update(bytes)
  }
  const actualAggregate = aggregate.digest('hex')
  if (actualAggregate !== bundle.sha256) {
    throw new Error(`${label} aggregate drift: expected ${bundle.sha256}, got ${actualAggregate}`)
  }
}

const upstreamContract = readFileSync(
  resolve(packageRoot, 'schemas/knowledge-shard/upstream-contract.json'),
)
const upstreamContractSha = sha256(upstreamContract)
if (upstreamContractSha !== receipt.source.contractSha256) {
  throw new Error(
    `upstream contract drift: expected ${receipt.source.contractSha256}, got ${upstreamContractSha}`,
  )
}

verifyBundle(receipt.schemaBundle, 'schema bundle')
verifyBundle(receipt.goldenCorpus, 'golden corpus')
verifyBundle(receipt.recordV1GoldenCorpus, 'record-v1 golden corpus')
const fullFixture = receipt.fullV1IntegratedFixture
for (const [path, expected, label] of [
  [fullFixture.vendoredArchive, fullFixture.archiveSha256, 'full-v1 integrated archive'],
  [fullFixture.vendoredReceipt, fullFixture.receiptSha256, 'full-v1 integrated receipt'],
]) {
  const actual = sha256(readFileSync(resolve(packageRoot, path)))
  if (actual !== expected) {
    throw new Error(`${label} drift: expected ${expected}, got ${actual}`)
  }
}
for (const [release, historical] of Object.entries(receipt.historicalReleases ?? {})) {
  verifyBundle(historical.schemaBundle, `${release} historical schema bundle`)
  verifyBundle(historical.goldenCorpus, `${release} historical golden corpus`)
}

const v2Contract = readFileSync(resolve(packageRoot, 'schemas/knowledge-shard/2.0.0/contract.json'))
if (sha256(v2Contract) !== v2Receipt.source.contractSha256) {
  throw new Error('Knowledge Shard 2.0 authority descriptor drift')
}
verifyBundle(v2Receipt.schemaBundle, 'schema 2.0 bundle')
const v2Fixture = readFileSync(resolve(packageRoot, v2Receipt.canonicalCorpus.vendoredPath))
if (sha256(v2Fixture) !== v2Receipt.canonicalCorpus.sha256) {
  throw new Error('Knowledge Shard 2.0 canonical presence corpus drift')
}
if (v2Receipt.status !== 'specified-implementation-pending') {
  throw new Error('Knowledge Shard 2.0 receipt must not advertise runtime support without evidence')
}
if (v2ImplementationReceipt.status !== 'local-conformance-passed') {
  throw new Error('Knowledge Shard 2.0 implementation receipt has not passed local conformance')
}
if (
  v2ImplementationReceipt.authority.commit !== v2Receipt.source.commit
  || v2ImplementationReceipt.authority.schemaBundleSha256 !== v2Receipt.schemaBundle.sha256
) {
  throw new Error('Knowledge Shard 2.0 implementation receipt authority mismatch')
}
for (const [path, expected] of Object.entries(v2ImplementationReceipt.implementation)) {
  const actual = sha256(readFileSync(resolve(packageRoot, path)))
  if (actual !== expected) {
    throw new Error(`Knowledge Shard 2.0 implementation drift: ${path}`)
  }
}
const implementationArchive = readFileSync(resolve(packageRoot, v2ImplementationReceipt.archive.path))
if (
  implementationArchive.byteLength !== v2ImplementationReceipt.archive.bytes
  || sha256(implementationArchive) !== v2ImplementationReceipt.archive.sha256
) {
  throw new Error('Knowledge Shard 2.0 implementation archive drift')
}

console.log(
  `Knowledge Shard ${receipt.knowledgeShard.schemaVersion}/${receipt.knowledgeShard.profile}: ` +
    `${receipt.source.commit} ${receipt.schemaBundle.sha256}`,
)
console.log(
  `Knowledge Shard ${v2Receipt.knowledgeShard.schemaVersion} presence authority: ` +
    `${v2Receipt.source.commit} ${v2Receipt.schemaBundle.sha256} (${v2Receipt.status})`,
)
