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
const v2PresenceReceiptPath = resolve(
  packageRoot,
  'schemas/knowledge-shard-v2.presence.receipt.json',
)
const v2PresenceReceipt = JSON.parse(readFileSync(v2PresenceReceiptPath, 'utf8'))
const fortemiRuntimeReceiptPath = resolve(
  packageRoot,
  'schemas/knowledge-shard-v2.fortemi-runtime.receipt.json',
)
const fortemiRuntimeReceipt = JSON.parse(readFileSync(fortemiRuntimeReceiptPath, 'utf8'))
const crossRepositoryReceipt = JSON.parse(readFileSync(
  resolve(packageRoot, 'schemas/knowledge-shard-v2.cross-repository.receipt.json'),
  'utf8',
))
const coreV1PgliteSelfReceipt = JSON.parse(readFileSync(
  resolve(packageRoot, 'schemas/knowledge-shard-core-v1-pglite-self.receipt.json'),
  'utf8',
))
const coreV1PgliteToFortemiReceipt = JSON.parse(readFileSync(
  resolve(packageRoot, 'schemas/knowledge-shard-core-v1-pglite-to-fortemi.receipt.json'),
  'utf8',
))
const coreV1FortemiToPgliteReceipt = JSON.parse(readFileSync(
  resolve(packageRoot, 'schemas/knowledge-shard-core-v1-fortemi-to-pglite.receipt.json'),
  'utf8',
))

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requireReceipt(condition, message) {
  if (!condition) throw new Error(`Knowledge Shard cross-repository receipt drift: ${message}`)
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

const completeCoreV1Coverage = [
  'hierarchy',
  'metadata',
  'nulls',
  'tombstones',
  'current-minus-two',
  'current',
  'next-major-rejection',
  'malformed-input',
  'resource-limits',
]
const coreV1SelfFixture = readFileSync(
  resolve(packageRoot, '..', '..', coreV1PgliteSelfReceipt.fixture.path),
)
requireReceipt(
  coreV1PgliteSelfReceipt.cell === 'pglite-core-v1-to-pglite'
    && coreV1PgliteSelfReceipt.producer.commit
      === '9fdaa61a8da05c7d45ac7ff555d158cbe3dc1d2d'
    && coreV1PgliteSelfReceipt.producer.package.name === '@fortemi/core'
    && coreV1PgliteSelfReceipt.producer.package.version === '2026.7.13',
  'PGlite core-v1 self-cell producer identity drifted',
)
requireReceipt(
  coreV1PgliteSelfReceipt.authority.commit === receipt.source.commit
    && coreV1PgliteSelfReceipt.authority.contractSha256 === receipt.source.contractSha256
    && coreV1PgliteSelfReceipt.authority.schemaBundleSha256 === receipt.schemaBundle.sha256
    && coreV1PgliteSelfReceipt.authority.schemaVersion
      === receipt.knowledgeShard.schemaVersion,
  'PGlite core-v1 self-cell authority binding drifted',
)
requireReceipt(
  coreV1SelfFixture.byteLength === coreV1PgliteSelfReceipt.fixture.bytes
    && sha256(coreV1SelfFixture) === coreV1PgliteSelfReceipt.fixture.sha256
    && coreV1PgliteSelfReceipt.fixture.profile === 'core-v1',
  'PGlite core-v1 self-cell fixture drifted',
)
requireReceipt(
  JSON.stringify(coreV1PgliteSelfReceipt.coverage)
      === JSON.stringify(completeCoreV1Coverage)
    && coreV1PgliteSelfReceipt.consumer.cleanDestination === true
    && coreV1PgliteSelfReceipt.consumer.semanticReexport === true
    && coreV1PgliteSelfReceipt.consumer.zeroMutationOnFailure === true
    && coreV1PgliteSelfReceipt.consumer.currentMinusTwo.accepted === true
    && coreV1PgliteSelfReceipt.consumer.nextMajor.rejected === true
    && coreV1PgliteSelfReceipt.consumer.malformedInputRejected === true
    && coreV1PgliteSelfReceipt.consumer.resourceLimits.rejectedBeforeMutation === true
    && coreV1PgliteSelfReceipt.consumer.persistentMutationAfterRejection === 0,
  'PGlite core-v1 self-cell coverage or consumer evidence drifted',
)
requireReceipt(
  coreV1PgliteSelfReceipt.claimBoundary.suiteWide === false
    && coreV1PgliteSelfReceipt.claimBoundary.completeBackup === false
    && coreV1PgliteSelfReceipt.claimBoundary.crossRepository === false,
  'PGlite core-v1 self-cell claim boundary widened',
)
requireReceipt(
  coreV1PgliteToFortemiReceipt.status === 'delivered-main-conformance-passed'
    && coreV1PgliteToFortemiReceipt.cell === 'pglite-core-v1-to-fortemi'
    && coreV1PgliteToFortemiReceipt.producer.commit
      === coreV1PgliteSelfReceipt.producer.commit
    && coreV1PgliteToFortemiReceipt.fixture.sha256
      === coreV1PgliteSelfReceipt.fixture.sha256
    && coreV1PgliteToFortemiReceipt.fixture.bytes
      === coreV1PgliteSelfReceipt.fixture.bytes,
  'PGlite-to-Fortemi core-v1 producer or fixture binding drifted',
)
requireReceipt(
  coreV1PgliteToFortemiReceipt.authority.commit === receipt.source.commit
    && coreV1PgliteToFortemiReceipt.authority.contractSha256
      === receipt.source.contractSha256
    && coreV1PgliteToFortemiReceipt.authority.schemaBundleSha256
      === receipt.schemaBundle.sha256
    && coreV1PgliteToFortemiReceipt.authority.schemaVersion
      === receipt.knowledgeShard.schemaVersion,
  'PGlite-to-Fortemi core-v1 authority binding drifted',
)
requireReceipt(
  coreV1PgliteToFortemiReceipt.consumer.commit
      === '11125eb9ac97494745a834efbc0a865117d5f2b6'
    && coreV1PgliteToFortemiReceipt.tests.deliveredMain.commit
      === coreV1PgliteToFortemiReceipt.consumer.commit
    && coreV1PgliteToFortemiReceipt.tests.deliveredMain.conclusion === 'success'
    && coreV1PgliteToFortemiReceipt.tests.focusedResult.passed === 2
    && coreV1PgliteToFortemiReceipt.tests.focusedResult.failed === 0,
  'PGlite-to-Fortemi core-v1 delivered consumer evidence drifted',
)
requireReceipt(
  JSON.stringify(coreV1PgliteToFortemiReceipt.coverage)
      === JSON.stringify(completeCoreV1Coverage)
    && coreV1PgliteToFortemiReceipt.consumer.cleanDestination === true
    && coreV1PgliteToFortemiReceipt.consumer.semanticReexport === true
    && coreV1PgliteToFortemiReceipt.consumer.zeroMutationOnFailure === true
    && coreV1PgliteToFortemiReceipt.consumer.hierarchyPreserved === true
    && coreV1PgliteToFortemiReceipt.consumer.metadataValuePreserved === true
    && coreV1PgliteToFortemiReceipt.consumer.explicitNullMetadataPreserved === true
    && coreV1PgliteToFortemiReceipt.consumer.tombstonePreserved === true
    && coreV1PgliteToFortemiReceipt.consumer.currentMinusTwo.accepted === true
    && coreV1PgliteToFortemiReceipt.consumer.nextMajor.rejected === true
    && coreV1PgliteToFortemiReceipt.consumer.malformedInputRejected === true
    && coreV1PgliteToFortemiReceipt.consumer.resourceLimits.rejectedBeforeMutation === true
    && coreV1PgliteToFortemiReceipt.consumer.persistentMutationAfterRejection === 0,
  'PGlite-to-Fortemi core-v1 coverage or consumer evidence drifted',
)
requireReceipt(
  coreV1PgliteToFortemiReceipt.claimBoundary.suiteWide === false
    && coreV1PgliteToFortemiReceipt.claimBoundary.completeBackup === false
    && coreV1PgliteToFortemiReceipt.claimBoundary.crossRepository === true
    && coreV1PgliteToFortemiReceipt.claimBoundary.cell
      === coreV1PgliteToFortemiReceipt.cell,
  'PGlite-to-Fortemi core-v1 claim boundary widened',
)
const coreV1FortemiFixture = readFileSync(
  resolve(packageRoot, '..', '..', coreV1FortemiToPgliteReceipt.fixture.path),
)
requireReceipt(
  coreV1FortemiToPgliteReceipt.status === 'delivered-main-conformance-passed'
    && coreV1FortemiToPgliteReceipt.cell === 'fortemi-core-v1-to-pglite'
    && coreV1FortemiToPgliteReceipt.producer.commit
      === 'b53f1429e409ad02b6c9513218cb62adb9f19c71'
    && coreV1FortemiToPgliteReceipt.producer.cellReceipt.commit
      === '6488cd890108b7eda20fa1366ec6bcebfd1e3684',
  'Fortemi-to-PGlite core-v1 producer identity drifted',
)
requireReceipt(
  coreV1FortemiToPgliteReceipt.authority.commit === receipt.source.commit
    && coreV1FortemiToPgliteReceipt.authority.contractSha256
      === receipt.source.contractSha256
    && coreV1FortemiToPgliteReceipt.authority.schemaBundleSha256
      === receipt.schemaBundle.sha256
    && coreV1FortemiToPgliteReceipt.authority.schemaVersion
      === receipt.knowledgeShard.schemaVersion,
  'Fortemi-to-PGlite core-v1 authority binding drifted',
)
requireReceipt(
  coreV1FortemiFixture.byteLength === coreV1FortemiToPgliteReceipt.fixture.bytes
    && sha256(coreV1FortemiFixture) === coreV1FortemiToPgliteReceipt.fixture.sha256
    && coreV1FortemiToPgliteReceipt.fixture.profile === 'core-v1',
  'Fortemi-to-PGlite core-v1 fixture drifted',
)
requireReceipt(
  coreV1FortemiToPgliteReceipt.consumer.commit
      === 'fb570b8503eb82bcb5509b652c234c9e8582a941'
    && coreV1FortemiToPgliteReceipt.consumer.package.name === '@fortemi/core'
    && coreV1FortemiToPgliteReceipt.consumer.package.version === '2026.7.13'
    && coreV1FortemiToPgliteReceipt.tests.deliveredMain.commit
      === coreV1FortemiToPgliteReceipt.consumer.commit
    && coreV1FortemiToPgliteReceipt.tests.deliveredMain.conclusion === 'success'
    && coreV1FortemiToPgliteReceipt.tests.deliveredMain.portableContract.passed === 281
    && coreV1FortemiToPgliteReceipt.tests.deliveredMain.portableContract.failed === 0
    && coreV1FortemiToPgliteReceipt.tests.focusedResult.passed === 5
    && coreV1FortemiToPgliteReceipt.tests.focusedResult.failed === 0,
  'Fortemi-to-PGlite core-v1 delivered consumer evidence drifted',
)
requireReceipt(
  JSON.stringify(coreV1FortemiToPgliteReceipt.coverage)
      === JSON.stringify(completeCoreV1Coverage)
    && coreV1FortemiToPgliteReceipt.consumer.cleanDestination === true
    && coreV1FortemiToPgliteReceipt.consumer.semanticReexport === true
    && coreV1FortemiToPgliteReceipt.consumer.zeroMutationOnFailure === true
    && coreV1FortemiToPgliteReceipt.consumer.hierarchyPreserved === true
    && coreV1FortemiToPgliteReceipt.consumer.metadataValuePreserved === true
    && coreV1FortemiToPgliteReceipt.consumer.explicitNullMetadataPreserved === true
    && coreV1FortemiToPgliteReceipt.consumer.tombstonePreserved === true
    && coreV1FortemiToPgliteReceipt.consumer.attachmentProjectionsPreserved === true
    && coreV1FortemiToPgliteReceipt.consumer.currentMinusTwo.accepted === true
    && coreV1FortemiToPgliteReceipt.consumer.nextMajor.rejected === true
    && coreV1FortemiToPgliteReceipt.consumer.malformedInputRejected === true
    && coreV1FortemiToPgliteReceipt.consumer.resourceLimits.rejectedBeforeMutation === true
    && coreV1FortemiToPgliteReceipt.consumer.persistentMutationAfterRejection === 0,
  'Fortemi-to-PGlite core-v1 coverage or consumer evidence drifted',
)
requireReceipt(
  coreV1FortemiToPgliteReceipt.claimBoundary.suiteWide === false
    && coreV1FortemiToPgliteReceipt.claimBoundary.completeBackup === false
    && coreV1FortemiToPgliteReceipt.claimBoundary.crossRepository === true
    && coreV1FortemiToPgliteReceipt.claimBoundary.cell
      === coreV1FortemiToPgliteReceipt.cell,
  'Fortemi-to-PGlite core-v1 claim boundary widened',
)

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
if (v2PresenceReceipt.status !== 'local-conformance-passed') {
  throw new Error('Knowledge Shard 2.0 presence receipt has not passed local conformance')
}
if (
  v2PresenceReceipt.authority.commit !== v2Receipt.source.commit
  || v2PresenceReceipt.authority.schemaBundleSha256 !== v2Receipt.schemaBundle.sha256
  || v2PresenceReceipt.authority.fieldSemanticsSha256
    !== v2Receipt.schemaBundle.files['field-semantics.json']
) {
  throw new Error('Knowledge Shard 2.0 presence receipt authority mismatch')
}
const fieldSemantics = JSON.parse(readFileSync(
  resolve(packageRoot, 'schemas/knowledge-shard/2.0.0/field-semantics.json'),
  'utf8',
))
if (
  v2PresenceReceipt.matrix.fields !== fieldSemantics.fields.length
  || v2PresenceReceipt.matrix.wildcardFields
    !== fieldSemantics.fields.filter((field) => field.pointer.includes('/*')).length
  || v2PresenceReceipt.matrix.semanticAssertions !== fieldSemantics.fields.length * 6
) {
  throw new Error('Knowledge Shard 2.0 presence receipt matrix mismatch')
}
for (const [path, expected] of Object.entries(v2PresenceReceipt.implementation)) {
  const actual = sha256(readFileSync(resolve(packageRoot, path)))
  if (actual !== expected) {
    throw new Error(`Knowledge Shard 2.0 presence implementation drift: ${path}`)
  }
}
const implementationArchive = readFileSync(resolve(packageRoot, v2ImplementationReceipt.archive.path))
if (
  implementationArchive.byteLength !== v2ImplementationReceipt.archive.bytes
  || sha256(implementationArchive) !== v2ImplementationReceipt.archive.sha256
) {
  throw new Error('Knowledge Shard 2.0 implementation archive drift')
}

const completeFullV1Coverage = [
  'all-33-components',
  'all-34-count-fields',
  'attachment-bytes',
  'signatures',
  'identities',
  'relationships',
  'timestamps',
  'tombstones',
  'absent-null-empty-value',
  '768-dimensional-embeddings',
  'embedding-contract-lineage',
  'skos',
  'provenance',
  'graph-community',
  'current-minus-two',
  'current',
  'next-major-rejection',
  'malformed-input',
  'tampered-input',
  'resource-limits',
  'repeated-imports',
  'zero-mutation-on-rejection',
]
const expectedCells = [
  'pglite-full-v1-to-pglite',
  'aiwg-full-v1-to-pglite',
  'pglite-full-v1-to-fortemi',
  'aiwg-full-v1-to-fortemi',
]
requireReceipt(
  crossRepositoryReceipt.status === 'delivered-cross-repository-conformance-passed',
  'status is not passed',
)
requireReceipt(
  crossRepositoryReceipt.tuple.schemaVersion === '2.0.0'
    && crossRepositoryReceipt.tuple.profile === 'full-v1',
  'tuple is not exact 2.0.0/full-v1',
)
requireReceipt(
  crossRepositoryReceipt.authority.commit === v2Receipt.source.commit
    && crossRepositoryReceipt.authority.contractSha256 === v2Receipt.source.contractSha256
    && crossRepositoryReceipt.authority.schemaBundleSha256 === v2Receipt.schemaBundle.sha256,
  'authority binding does not match the pinned schema-2 receipt',
)
requireReceipt(
  crossRepositoryReceipt.evidence.localImplementationReceiptSha256
    === sha256(readFileSync(v2ImplementationReceiptPath))
    && crossRepositoryReceipt.reactProducer.archive.sha256
      === v2ImplementationReceipt.archive.sha256,
  'released PGlite implementation/archive binding failed',
)
requireReceipt(
  crossRepositoryReceipt.evidence.fortemiRuntimeReceiptSha256
    === sha256(readFileSync(fortemiRuntimeReceiptPath))
    && crossRepositoryReceipt.fortemiConsumer.implementationCommit
      === fortemiRuntimeReceipt.implementation.commit
    && /^[0-9a-f]{40}$/.test(crossRepositoryReceipt.fortemiConsumer.receipt.commit)
    && !/^0+$/.test(crossRepositoryReceipt.fortemiConsumer.receipt.commit)
    && crossRepositoryReceipt.fortemiConsumer.receipt.commit
      === '2e812aa66ba108a824475a97b1ddba4d1412dec7'
    && crossRepositoryReceipt.fortemiConsumer.receipt.sha256
      === crossRepositoryReceipt.evidence.fortemiRuntimeReceiptSha256
    && fortemiRuntimeReceipt.status === 'delivered-main-conformance-passed'
    && fortemiRuntimeReceipt.implementation.deliveredMain.conclusion === 'success',
  'Fortemi runtime receipt binding failed',
)
requireReceipt(
  crossRepositoryReceipt.reactProducer.commit === '45ee08e99dfb6fa0263aca2992aa6de91e2f1e98'
    && crossRepositoryReceipt.reactProducer.tag === 'v2026.7.13'
    && crossRepositoryReceipt.reactProducer.package.name === '@fortemi/core'
    && crossRepositoryReceipt.reactProducer.package.version === '2026.7.13'
    && crossRepositoryReceipt.reactProducer.package.shasum
      === 'd829b24cca7bf50689b936417ce607b6f75e9966'
    && crossRepositoryReceipt.reactProducer.package.integrity
      === 'sha512-bFf77/wQhJ9M9m/0M3TM1S13EkmfrBM/O5sVaTkXJaeo1uyCuvP46T9ZVm3pGae30AkpWI3fDxuwo2AvEOBKOw==',
  'released React package identity drifted',
)
requireReceipt(
  crossRepositoryReceipt.aiwgProducer.fixtureCommit
    === fortemiRuntimeReceipt.aiwgProducer.fixtureCommit
    && crossRepositoryReceipt.aiwgProducer.deliveredMainCommit
      === fortemiRuntimeReceipt.aiwgProducer.deliveredMainCommit
    && crossRepositoryReceipt.aiwgProducer.archive.sha256
      === fortemiRuntimeReceipt.aiwgProducer.archive.sha256,
  'delivered AIWG producer identity drifted',
)
for (const [producer, archive, expectedPath] of [
  [
    'reactProducer',
    crossRepositoryReceipt.reactProducer.archive,
    'src/__tests__/shard/fixtures/full-v1/server-full-v1-revision-19-v2.shard',
  ],
  [
    'aiwgProducer',
    crossRepositoryReceipt.aiwgProducer.archive,
    'src/__tests__/shard/fixtures/aiwg-full-v1/aiwg-full-v1.shard',
  ],
]) {
  requireReceipt(archive.path === expectedPath, `${producer} archive path drifted`)
  const bytes = readFileSync(resolve(packageRoot, archive.path))
  requireReceipt(bytes.byteLength === archive.bytes, `${producer} archive byte length drifted`)
  requireReceipt(sha256(bytes) === archive.sha256, `${producer} archive digest drifted`)
}
requireReceipt(
  crossRepositoryReceipt.cells.length === 4
    && JSON.stringify(crossRepositoryReceipt.cells.map((cell) => cell.id))
      === JSON.stringify(expectedCells)
    && crossRepositoryReceipt.cells.every((cell) =>
      cell.status === 'passed'
      && JSON.stringify(cell.coverage) === JSON.stringify(completeFullV1Coverage)),
  'each independent producer/consumer cell must bind complete per-cell coverage',
)
requireReceipt(
  crossRepositoryReceipt.advertisement.backend === 'pglite'
    && crossRepositoryReceipt.advertisement.profile === 'full-v1'
    && crossRepositoryReceipt.advertisement.schemaVersion === '2.0.0'
    && crossRepositoryReceipt.advertisement.enabled === true
    && crossRepositoryReceipt.claims.suiteWide === false,
  'advertisement or suite-claim boundary drifted',
)
requireReceipt(
  crossRepositoryReceipt.coordination.reactProfileIssue
    === 'https://git.integrolabs.net/Fortemi/fortemi-react/issues/355'
    && crossRepositoryReceipt.coordination.reactConvergenceIssue
      === 'https://git.integrolabs.net/Fortemi/fortemi-react/issues/356'
    && crossRepositoryReceipt.coordination.fortemiDestinationIssue
      === 'https://git.integrolabs.net/Fortemi/fortemi/issues/1084',
  'paired issue traceability drifted',
)

console.log(
  `Knowledge Shard ${receipt.knowledgeShard.schemaVersion}/${receipt.knowledgeShard.profile}: ` +
    `${receipt.source.commit} ${receipt.schemaBundle.sha256}`,
)
console.log(
  `Knowledge Shard ${v2Receipt.knowledgeShard.schemaVersion} presence authority: ` +
    `${v2Receipt.source.commit} ${v2Receipt.schemaBundle.sha256} (${v2Receipt.status})`,
)
