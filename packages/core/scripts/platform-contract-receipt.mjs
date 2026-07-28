import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIVE_COMMAND_ID,
  verifyLiveServerContractReceipt,
} from './live-server-contract.mjs'

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '..', '..')

export const RECEIPT_SCHEMA = 'fortemi.platform-contract-receipt.v1'
export const COMMAND_ID = 'fortemi-react.platform-contract.v1'
export const RUN_COMMAND = 'pnpm test:platform-contract --output <path>'
export const PREFLIGHT_COMMAND =
  'pnpm --filter @fortemi/core verify:knowledge-shard-contract'
export const PORTABLE_CONTRACT_COMMAND = 'pnpm test:portable-contract'
export const VERIFY_COMMAND = 'pnpm verify:platform-contract-receipt <path>'

const PROFILE_NAMES = ['core-v1', 'record-v1', 'full-v1']
const REQUIRED_V1_RECEIPTS = [
  'knowledge-shard-core-v1-pglite-self.receipt.json',
  'knowledge-shard-core-v1-fortemi-to-pglite.receipt.json',
  'knowledge-shard-core-v1-pglite-to-fortemi.receipt.json',
  'knowledge-shard-record-v1-recordstore-self.receipt.json',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  )
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value))
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readPinnedReceipt(packageRoot, filename) {
  const path = resolve(packageRoot, 'schemas', filename)
  const bytes = readFileSync(path)
  return {
    filename,
    value: JSON.parse(bytes.toString('utf8')),
    sha256: sha256(bytes),
  }
}

function profileDigest(schemaBundle, profile) {
  const files = Object.fromEntries(
    Object.entries(schemaBundle.files)
      .filter(([path]) => path.startsWith(`${profile}/`))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  if (Object.keys(files).length === 0) {
    throw new Error(`Pinned authority receipt has no ${profile} schemas`)
  }
  return {
    algorithm: 'sha256(canonical pinned path-to-digest map)',
    sha256: sha256(canonicalJson(files)),
    fileCount: Object.keys(files).length,
  }
}

function authorityBinding(receipt, contract, pinnedReceipt) {
  return {
    repository: receipt.source.repository,
    commit: receipt.source.commit,
    contractRevision: contract.contractRevision,
    schemaVersion: receipt.knowledgeShard.schemaVersion,
    contractSha256: receipt.source.contractSha256,
    schemaBundleSha256: receipt.schemaBundle.sha256,
    fieldSemanticsSha256:
      receipt.schemaBundle.files['field-semantics.json'] ?? null,
    pinnedReceipt: {
      path: `packages/core/schemas/${pinnedReceipt.filename}`,
      sha256: pinnedReceipt.sha256,
    },
    profileDigests: Object.fromEntries(
      PROFILE_NAMES.map((profile) => [
        profile,
        profileDigest(receipt.schemaBundle, profile),
      ]),
    ),
    ...(receipt.selection
      ? {
          advertisement: {
            status: receipt.status,
            selection: receipt.selection,
          },
          historicalLineage: {
            authorityContractRevision:
              receipt.historicalLineage.authorityContractRevision,
            authorityCommit: receipt.historicalLineage.authorityCommit,
            immutable: receipt.historicalLineage.immutable,
            receiptDigests: Object.fromEntries(
              Object.entries(receipt.historicalLineage.receipts)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([filename, binding]) => [filename, binding.sha256]),
            ),
          },
        }
      : {}),
  }
}

function v1Cell(receipt) {
  const consumer = receipt.consumer
  const currentMinusTwo = consumer.currentMinusTwo
  return {
    id: receipt.cell,
    plane: 'knowledge-shard',
    schemaVersion: receipt.claimBoundary.schemaVersion,
    profile: receipt.claimBoundary.profile,
    producer: receipt.producer.repository,
    consumer: consumer.id,
    status: 'passed',
    results: {
      cleanDestination: consumer.cleanDestination === true,
      currentSchema: true,
      currentMinusTwo:
        currentMinusTwo.accepted === true
          ? 'accepted'
          : currentMinusTwo.rejectedBeforeMutation === true
            ? 'profile-undefined-rejected-before-mutation'
            : 'not-proven',
      nextMajorRejected: consumer.nextMajor.rejected === true,
      malformedInputRejected: consumer.malformedInputRejected === true,
      resourceLimitRejectedBeforeMutation:
        consumer.resourceLimits.rejectedBeforeMutation === true,
      zeroMutationOnRejection:
        consumer.zeroMutationOnFailure === true
        && consumer.persistentMutationAfterRejection === 0,
    },
    claimBoundary: receipt.claimBoundary,
  }
}

function v2Cell(cell, historicalAuthority) {
  const coverage = cell.coverage
  return {
    id: cell.id,
    plane: cell.producer === 'aiwg-index-converter'
      ? 'aiwg-to-shard-bridge'
      : 'knowledge-shard',
    schemaVersion: '2.0.0',
    profile: 'full-v1',
    producer: cell.producer,
    consumer: cell.consumer,
    status: cell.status,
    evidenceAuthority: {
      contractRevision: historicalAuthority.contractRevision,
      commit: historicalAuthority.commit,
      lineage: 'historical-implementation-evidence',
    },
    results: {
      cleanDestination: true,
      currentSchema: coverage.includes('current'),
      currentMinusTwo: coverage.includes('current-minus-two') ? 'accepted' : 'not-proven',
      nextMajorRejected: coverage.includes('next-major-rejection'),
      malformedInputRejected: coverage.includes('malformed-input'),
      resourceLimitRejectedBeforeMutation: coverage.includes('resource-limits'),
      zeroMutationOnRejection: coverage.includes('zero-mutation-on-rejection'),
    },
    claimBoundary: {
      suiteWide: false,
      completeBackup: false,
      crossRepository: cell.consumer === 'fortemi-postgresql',
    },
  }
}

export function loadPinnedContractEvidence({ packageRoot = PACKAGE_ROOT } = {}) {
  const packageJson = readJson(resolve(packageRoot, 'package.json'))
  const v1Pinned = readPinnedReceipt(
    packageRoot,
    'knowledge-shard.schema.receipt.json',
  )
  const v2Pinned = readPinnedReceipt(
    packageRoot,
    'knowledge-shard-v2.advertisement.receipt.json',
  )
  const v1Contract = readJson(
    resolve(packageRoot, 'schemas/knowledge-shard/upstream-contract.json'),
  )
  const v2Contract = readJson(
    resolve(packageRoot, 'schemas/knowledge-shard/2.0.0/contract.json'),
  )
  const v1Receipts = REQUIRED_V1_RECEIPTS.map((filename) =>
    readPinnedReceipt(packageRoot, filename).value)
  const crossRepository = readPinnedReceipt(
    packageRoot,
    'knowledge-shard-v2.cross-repository.receipt.json',
  ).value
  const recordStoreReceipt = v1Receipts.find(
    (receipt) => receipt.cell === 'recordstore-record-v1-to-recordstore',
  )
  if (!recordStoreReceipt) throw new Error('Pinned RecordStore cell receipt is missing')

  const cells = [
    ...v1Receipts.map(v1Cell),
    ...crossRepository.cells.map((cell) => v2Cell(cell, crossRepository.authority)),
  ]
  const knowledgeShardCells = cells
    .filter((cell) => cell.plane === 'knowledge-shard')
    .map((cell) => cell.id)
  const aiwgBridgeCells = cells
    .filter((cell) => cell.plane === 'aiwg-to-shard-bridge')
    .map((cell) => cell.id)

  return {
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    authority: [
      authorityBinding(v1Pinned.value, v1Contract, v1Pinned),
      authorityBinding(v2Pinned.value, v2Contract, v2Pinned),
    ],
    coverage: {
      backends: [
        {
          id: 'pglite',
          execution: 'local-behavior-pinned-receipts-and-live-fortemi-server-export',
          tuples: [
            {
              schemaVersion: '1.2.0',
              profile: 'core-v1',
              operations: ['import', 'export'],
            },
            {
              schemaVersion: '2.0.0',
              profile: 'full-v1',
              operations: ['import', 'export'],
              receiptBacked: true,
            },
          ],
        },
        {
          id: 'recordstore',
          execution: 'local-behavior',
          implementations: ['memory', 'indexeddb'],
          tuples: [
            {
              schemaVersion: '1.2.0',
              profile: 'record-v1',
              operations: ['import', 'export'],
              lossy: true,
            },
          ],
        },
      ],
      cells,
      dataPlanes: {
        knowledgeShard: {
          cells: knowledgeShardCells,
        },
        aiwgToShardBridge: {
          separateContract: true,
          cells: aiwgBridgeCells,
        },
        aiwgStaticIndex: {
          mergedWithKnowledgeShard: false,
        },
        livePersistence: {
          covered: true,
          boundary: 'live Fortemi server export to clean React-core PGlite consumer',
          evidence: 'liveServer',
        },
      },
    },
    recordStore: {
      tuple: {
        schemaVersion: recordStoreReceipt.claimBoundary.schemaVersion,
        profile: recordStoreReceipt.claimBoundary.profile,
      },
      declaredLosses: recordStoreReceipt.declaredLosses,
      claimBoundary: recordStoreReceipt.claimBoundary,
    },
    claims: {
      suiteWide: false,
      completeBackup: false,
      universalPlatformPortability: false,
      recordStoreFullV1: false,
      sharedAiwgKnowledgeShardSchema: false,
      supportedPlatforms: ['linux/x86_64', 'darwin/arm64'],
      reason:
        'This receipt proves the declared profile cells and one live Fortemi server-to-core path on one supported platform.',
    },
  }
}

export function platformIdentity(platform, arch) {
  if (platform === 'linux' && arch === 'x64') {
    return {
      os: 'linux',
      arch: 'x86_64',
      nodePlatform: platform,
      nodeArch: arch,
      id: 'linux/x86_64',
    }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      os: 'darwin',
      arch: 'arm64',
      nodePlatform: platform,
      nodeArch: arch,
      id: 'darwin/arm64',
    }
  }
  throw new Error(
    `Unsupported platform ${platform}/${arch}; supported platforms are linux/x64 and darwin/arm64`,
  )
}

export function collectGitIdentity({
  repositoryRoot = REPOSITORY_ROOT,
  execFile = execFileSync,
} = {}) {
  const runGit = (args) =>
    execFile('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const changesText = runGit(['status', '--porcelain=v1', '--untracked-files=all'])
  const changes = changesText === '' ? [] : changesText.split('\n')
  return {
    remote: runGit(['remote', 'get-url', 'origin']),
    commit: runGit(['rev-parse', 'HEAD']),
    state: changes.length === 0 ? 'clean' : 'dirty',
    clean: changes.length === 0,
    changes,
  }
}

function commandIdentity() {
  return {
    id: COMMAND_ID,
    invocation: RUN_COMMAND,
    preflight: PREFLIGHT_COMMAND,
    authorityConformanceSuite: PORTABLE_CONTRACT_COMMAND,
    liveServerGate: LIVE_COMMAND_ID,
    verifier: VERIFY_COMMAND,
  }
}

function claimsForPlatform(claims, platform) {
  return {
    ...claims,
    supportedPlatforms: [platform.id],
    reason:
      'This receipt proves the declared profile cells and one live Fortemi '
      + `server-to-core path on ${platform.id}.`,
  }
}

export function sealReceipt(receipt) {
  const unsigned = { ...receipt }
  delete unsigned.receiptDigest
  return {
    ...unsigned,
    receiptDigest: {
      algorithm: 'sha256(canonical JSON without receiptDigest)',
      value: sha256(canonicalJson(unsigned)),
    },
  }
}

export function createPlatformContractReceipt({
  platform = process.platform,
  arch = process.arch,
  git,
  startedAt,
  completedAt,
  preflightDurationMs,
  suiteDurationMs,
  liveServer,
  liveServerDurationMs,
  packageRoot = PACKAGE_ROOT,
}) {
  verifyLiveServerContractReceipt(liveServer)
  const evidence = loadPinnedContractEvidence({ packageRoot })
  const executedPlatform = platformIdentity(platform, arch)
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    status: 'passed',
    command: commandIdentity(),
    repository: git,
    package: evidence.package,
    platform: executedPlatform,
    authority: evidence.authority,
    coverage: evidence.coverage,
    recordStore: evidence.recordStore,
    liveServer,
    run: {
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      preflight: {
        command: PREFLIGHT_COMMAND,
        status: 'passed',
        durationMs: preflightDurationMs,
      },
      portableContract: {
        command: PORTABLE_CONTRACT_COMMAND,
        status: 'passed',
        durationMs: suiteDurationMs,
      },
      liveServer: {
        command: LIVE_COMMAND_ID,
        status: 'passed',
        durationMs: liveServerDurationMs,
      },
    },
    claims: claimsForPlatform(evidence.claims, executedPlatform),
  }
  return sealReceipt(receipt)
}

function assertReceipt(condition, message) {
  if (!condition) throw new Error(`Platform contract receipt invalid: ${message}`)
}

function assertSame(actual, expected, label) {
  assertReceipt(canonicalJson(actual) === canonicalJson(expected), `${label} drifted`)
}

export function verifyPlatformContractReceipt(
  receipt,
  {
    packageRoot = PACKAGE_ROOT,
    expectedGit,
    requireClean = true,
  } = {},
) {
  const evidence = loadPinnedContractEvidence({ packageRoot })
  assertReceipt(receipt?.schemaVersion === RECEIPT_SCHEMA, 'unsupported receipt schema')
  assertReceipt(receipt.status === 'passed', 'run status is not passed')
  assertSame(receipt.command, commandIdentity(), 'command identity')
  assertSame(receipt.package, evidence.package, 'package identity')
  platformIdentity(receipt.platform?.nodePlatform, receipt.platform?.nodeArch)
  assertReceipt(
    receipt.platform.id === `${receipt.platform.os}/${receipt.platform.arch}`,
    'platform identity is inconsistent',
  )
  assertReceipt(/^[0-9a-f]{40}$/.test(receipt.repository?.commit), 'git commit is not exact')
  assertReceipt(
    receipt.repository.state === (receipt.repository.clean ? 'clean' : 'dirty'),
    'git clean/dirty state is inconsistent',
  )
  assertReceipt(
    Array.isArray(receipt.repository.changes)
      && receipt.repository.clean === (receipt.repository.changes.length === 0),
    'git change inventory is inconsistent',
  )
  if (requireClean) assertReceipt(receipt.repository.clean === true, 'git checkout is dirty')
  if (expectedGit) {
    assertReceipt(
      receipt.repository.commit === expectedGit.commit,
      'git commit does not match checkout',
    )
  }

  assertSame(receipt.authority, evidence.authority, 'authority binding')
  assertSame(receipt.coverage, evidence.coverage, 'required profile cells or advertisements')
  assertSame(receipt.recordStore, evidence.recordStore, 'RecordStore loss boundary')
  verifyLiveServerContractReceipt(receipt.liveServer)
  assertSame(
    receipt.claims,
    claimsForPlatform(evidence.claims, receipt.platform),
    'claim boundary',
  )
  assertReceipt(receipt.claims.suiteWide === false, 'suite-wide claim is forbidden')
  assertReceipt(receipt.claims.completeBackup === false, 'complete-backup claim is forbidden')
  assertReceipt(
    receipt.claims.universalPlatformPortability === false,
    'universal claim is forbidden',
  )

  const requiredCells = evidence.coverage.cells.map((cell) => cell.id)
  assertReceipt(
    receipt.coverage.cells.length === requiredCells.length
      && requiredCells.every((id) =>
        receipt.coverage.cells.some((cell) => cell.id === id && cell.status === 'passed')),
    'required cells are missing',
  )
  assertReceipt(
    receipt.coverage.cells.every((cell) =>
      cell.results.cleanDestination
      && cell.results.currentSchema
      && cell.results.currentMinusTwo !== 'not-proven'
      && cell.results.nextMajorRejected
      && cell.results.malformedInputRejected
      && cell.results.resourceLimitRejectedBeforeMutation
      && cell.results.zeroMutationOnRejection),
    'clean-destination, skew, rejection, or zero-mutation evidence is incomplete',
  )

  const startedAt = Date.parse(receipt.run?.startedAt)
  const completedAt = Date.parse(receipt.run?.completedAt)
  assertReceipt(
    Number.isFinite(startedAt) && Number.isFinite(completedAt),
    'run timestamps are invalid',
  )
  assertReceipt(completedAt >= startedAt, 'run completion precedes start')
  assertReceipt(
    receipt.run.durationMs === completedAt - startedAt,
    'run duration is inconsistent',
  )
  for (const result of [
    receipt.run.preflight,
    receipt.run.portableContract,
    receipt.run.liveServer,
  ]) {
    assertReceipt(result?.status === 'passed', 'a required command did not pass')
    assertReceipt(
      Number.isInteger(result.durationMs) && result.durationMs >= 0,
      'command duration is invalid',
    )
  }
  assertReceipt(receipt.run.preflight.command === PREFLIGHT_COMMAND, 'preflight command drifted')
  assertReceipt(
    receipt.run.portableContract.command === PORTABLE_CONTRACT_COMMAND,
    'portable-contract command drifted',
  )
  assertReceipt(receipt.run.liveServer.command === LIVE_COMMAND_ID, 'live-server command drifted')

  const expectedDigest = sealReceipt(receipt).receiptDigest
  assertSame(receipt.receiptDigest, expectedDigest, 'receipt digest')
  return receipt
}
