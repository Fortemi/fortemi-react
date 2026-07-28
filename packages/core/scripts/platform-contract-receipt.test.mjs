import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  createPlatformContractReceipt,
  platformIdentity,
  sealReceipt,
  verifyPlatformContractReceipt,
} from './platform-contract-receipt.mjs'
import {
  COMPATIBILITY_PATH,
  LIVE_COMMAND_ID,
  LIVE_RECEIPT_SCHEMA,
  SHARD_EXPORT_PATH,
  SHARD_EXPORT_QUERY,
  sealLiveServerReceipt,
} from './live-server-contract.mjs'
import { runPlatformContract } from './run-platform-contract.mjs'

const cleanGit = {
  remote: 'git@git.integrolabs.net:Fortemi/fortemi-react.git',
  commit: 'a'.repeat(40),
  state: 'clean',
  clean: true,
  changes: [],
}

function liveReceipt() {
  const cleanDatabase = {
    snapshots: 0,
    files: 0,
    componentRecords: 0,
    blobReferences: 0,
  }
  const cleanBlobs = { referenced: 0, missing: [], stored: 0 }
  return sealLiveServerReceipt({
    schemaVersion: LIVE_RECEIPT_SCHEMA,
    status: 'passed',
    command: {
      id: LIVE_COMMAND_ID,
      compatibility: `GET ${COMPATIBILITY_PATH}`,
      serverExport: `GET ${SHARD_EXPORT_PATH}?${SHARD_EXPORT_QUERY}`,
      coreConsumer: '@fortemi/core test consumer',
    },
    server: {
      origin: 'https://fortemi.example',
      authentication: {
        scheme: 'bearer',
        tokenProvided: true,
        tokenRecorded: false,
      },
      compatibility: {
        path: COMPATIBILITY_PATH,
        httpStatus: 200,
        validated: true,
        schemaVersion: 1,
        contractRevision: '21',
        apiName: 'fortemi',
        apiVersion: '2026.7.28',
        authRequired: true,
      },
      export: {
        path: SHARD_EXPORT_PATH,
        query: SHARD_EXPORT_QUERY,
        httpStatus: 200,
        bytes: 100,
        sha256: '1'.repeat(64),
        logicalFileSetSha256: '2'.repeat(64),
        logicalFileCount: 35,
        manifest: {
          version: '2.0.0',
          profile: 'full-v1',
          producer: { name: 'fortemi', version: '2026.7.28' },
          componentCount: 33,
          countFieldCount: 34,
        },
      },
    },
    coreConsumer: {
      backend: 'pglite-memory',
      tuple: { schemaVersion: '2.0.0', profile: 'full-v1' },
      cleanDestination: {
        satisfied: true,
        database: cleanDatabase,
        blobs: cleanBlobs,
      },
      rejection: {
        case: 'next-major-3.0.0',
        rejected: true,
        errors: ['unsupported tuple'],
        databaseAfter: cleanDatabase,
        blobsAfter: cleanBlobs,
        zeroMutation: true,
      },
      import: {
        success: true,
        databaseAfter: { ...cleanDatabase, snapshots: 1, files: 35 },
        componentCounts: {},
      },
      reexport: {
        success: true,
        validated: true,
        logicalFilesExact: true,
        logicalFileSetSha256: '2'.repeat(64),
        logicalFileCount: 35,
      },
    },
    dataPlanes: {
      knowledgeShard: 'live-fortemi-server-to-react-core',
      aiwgStaticIndex: false,
      aiwgToShardBridge: false,
    },
    claims: {
      exactTupleOnly: true,
      liveServerToCore: true,
      cleanDestination: true,
      zeroMutationOnRejection: true,
      completeBackup: false,
      suiteWide: false,
      persistencePlanesUnified: false,
    },
    run: {
      startedAt: '2026-07-28T12:00:02.000Z',
      completedAt: '2026-07-28T12:00:03.000Z',
      durationMs: 1000,
    },
  })
}

function receipt(overrides = {}) {
  return createPlatformContractReceipt({
    platform: 'linux',
    arch: 'x64',
    git: cleanGit,
    startedAt: '2026-07-28T12:00:00.000Z',
    completedAt: '2026-07-28T12:00:03.000Z',
    preflightDurationMs: 1000,
    suiteDurationMs: 2000,
    liveServer: liveReceipt(),
    liveServerDurationMs: 1000,
    ...overrides,
  })
}

test('accepts only Linux x86_64 and Darwin arm64', () => {
  assert.equal(platformIdentity('linux', 'x64').id, 'linux/x86_64')
  assert.equal(platformIdentity('darwin', 'arm64').id, 'darwin/arm64')
  assert.throws(() => platformIdentity('linux', 'arm64'), /Unsupported platform/)
  assert.throws(() => platformIdentity('darwin', 'x64'), /Unsupported platform/)
  assert.throws(() => platformIdentity('win32', 'x64'), /Unsupported platform/)
})

test('verifies an untampered receipt against pinned authority evidence', () => {
  assert.equal(
    verifyPlatformContractReceipt(receipt(), { expectedGit: cleanGit }).status,
    'passed',
  )
})

test('rejects authority drift, missing cells, unsupported advertisements, and broad claims', () => {
  const authorityDrift = receipt()
  authorityDrift.authority[0].profileDigests['core-v1'].sha256 = '0'.repeat(64)
  assert.throws(
    () => verifyPlatformContractReceipt(sealReceipt(authorityDrift)),
    /authority binding drifted/,
  )

  const missingCell = receipt()
  missingCell.coverage.cells.pop()
  assert.throws(
    () => verifyPlatformContractReceipt(sealReceipt(missingCell)),
    /required profile cells or advertisements drifted/,
  )

  const unsupportedAdvertisement = receipt()
  unsupportedAdvertisement.coverage.backends[1].tuples.push({
    schemaVersion: '2.0.0',
    profile: 'full-v1',
    operations: ['import'],
  })
  assert.throws(
    () => verifyPlatformContractReceipt(sealReceipt(unsupportedAdvertisement)),
    /required profile cells or advertisements drifted/,
  )

  const broadClaim = receipt()
  broadClaim.claims.suiteWide = true
  assert.throws(
    () => verifyPlatformContractReceipt(sealReceipt(broadClaim)),
    /claim boundary drifted/,
  )

  const liveDrift = receipt()
  liveDrift.liveServer.coreConsumer.rejection.zeroMutation = false
  assert.throws(
    () => verifyPlatformContractReceipt(sealReceipt(liveDrift)),
    /rejection evidence is incomplete/,
  )

  const revision20Server = receipt()
  revision20Server.liveServer.server.compatibility.contractRevision = '20'
  revision20Server.liveServer = sealLiveServerReceipt(revision20Server.liveServer)
  assert.throws(
    () => verifyPlatformContractReceipt(sealReceipt(revision20Server)),
    /compatibility evidence is incomplete/,
  )
})

test('rejects dirty receipts by default and permits explicit local verification', () => {
  const dirtyGit = {
    ...cleanGit,
    state: 'dirty',
    clean: false,
    changes: [' M package.json'],
  }
  const dirtyReceipt = receipt({ git: dirtyGit })
  assert.throws(
    () => verifyPlatformContractReceipt(dirtyReceipt),
    /git checkout is dirty/,
  )
  assert.equal(
    verifyPlatformContractReceipt(dirtyReceipt, { requireClean: false }).status,
    'passed',
  )
})

test('requires live server credentials before running any command', async () => {
  const calls = []
  await assert.rejects(
    runPlatformContract({
      outputPath: resolve(tmpdir(), 'unused-platform-receipt.json'),
      platform: 'linux',
      arch: 'x64',
      collectGit: () => cleanGit,
      runCommand: (args) => calls.push(args.join(' ')),
    }),
    /FORTEMI_PLATFORM_SERVER_URL and FORTEMI_PLATFORM_SERVER_TOKEN are required/,
  )
  assert.deepEqual(calls, [])
})

test('runs authority drift verification before the portable behavioral suite', async () => {
  const calls = []
  await assert.rejects(
    runPlatformContract({
      outputPath: resolve(tmpdir(), 'unused-platform-receipt.json'),
      serverUrl: 'https://fortemi.example',
      serverToken: 'secret',
      platform: 'linux',
      arch: 'x64',
      collectGit: () => cleanGit,
      runCommand: (args) => {
        calls.push(args.join(' '))
        throw new Error('preflight drift')
      },
    }),
    /preflight drift/,
  )
  assert.deepEqual(calls, ['--filter @fortemi/core verify:knowledge-shard-contract'])
})

test('emits a receipt only after preflight, portable suite, and live gate pass', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'fortemi-platform-contract-'))
  const outputPath = resolve(directory, 'receipt.json')
  const calls = []
  const times = [
    new Date('2026-07-28T12:00:00.000Z'),
    new Date('2026-07-28T12:00:03.000Z'),
  ]
  await runPlatformContract({
    outputPath,
    serverUrl: 'https://fortemi.example',
    serverToken: 'secret',
    platform: 'linux',
    arch: 'x64',
    collectGit: () => cleanGit,
    runCommand: (args) => calls.push(args.join(' ')),
    liveGate: async ({ serverUrl, token }) => {
      calls.push(`live ${serverUrl} ${token === 'secret' ? 'token-present' : 'token-missing'}`)
      return liveReceipt()
    },
    now: () => times.shift(),
  })

  assert.deepEqual(calls, [
    '--filter @fortemi/core verify:knowledge-shard-contract',
    'test:portable-contract',
    'live https://fortemi.example token-present',
  ])
  const emitted = JSON.parse(readFileSync(outputPath, 'utf8'))
  assert.equal(emitted.command.authorityConformanceSuite, 'pnpm test:portable-contract')
  assert.equal(emitted.platform.id, 'linux/x86_64')
  assert.equal(emitted.liveServer.claims.liveServerToCore, true)
})
