#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PREFLIGHT_COMMAND,
  PORTABLE_CONTRACT_COMMAND,
  REPOSITORY_ROOT,
  collectGitIdentity,
  createPlatformContractReceipt,
  platformIdentity,
  verifyPlatformContractReceipt,
} from './platform-contract-receipt.mjs'
import { runLiveServerContract } from './live-server-contract.mjs'

function parseArgs(args) {
  let outputPath
  let allowDirty = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--output') {
      outputPath = args[index + 1]
      index += 1
    } else if (argument === '--allow-dirty') {
      allowDirty = true
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (!outputPath) {
    throw new Error('Usage: pnpm test:platform-contract --output <receipt.json>')
  }
  return { outputPath: resolve(process.cwd(), outputPath), allowDirty }
}

function runPnpm(args, repositoryRoot) {
  const result = spawnSync('pnpm', args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? result.signal}): pnpm ${args.join(' ')}`)
  }
}

function requireLiveServerInputs(serverUrl, serverToken) {
  if (!serverUrl || !serverToken) {
    throw new Error(
      'FORTEMI_PLATFORM_SERVER_URL and FORTEMI_PLATFORM_SERVER_TOKEN are required',
    )
  }
}

async function timedRun(run) {
  const started = Date.now()
  const value = await run()
  return { value, durationMs: Date.now() - started }
}

export async function runPlatformContract({
  outputPath,
  allowDirty = false,
  serverUrl = process.env.FORTEMI_PLATFORM_SERVER_URL,
  serverToken = process.env.FORTEMI_PLATFORM_SERVER_TOKEN,
  platform = process.platform,
  arch = process.arch,
  repositoryRoot = REPOSITORY_ROOT,
  collectGit = () => collectGitIdentity({ repositoryRoot }),
  runCommand = runPnpm,
  liveGate = runLiveServerContract,
  now = () => new Date(),
} = {}) {
  if (!outputPath) throw new Error('A receipt output path is required')
  requireLiveServerInputs(serverUrl, serverToken)
  platformIdentity(platform, arch)
  const gitBefore = collectGit()
  if (!allowDirty && !gitBefore.clean) {
    throw new Error('Platform contract receipts require a clean git checkout')
  }

  const startedAt = now().toISOString()
  const preflight = await timedRun(() =>
    runCommand(
      ['--filter', '@fortemi/core', 'verify:knowledge-shard-contract'],
      repositoryRoot,
    ),
  )
  const suite = await timedRun(() =>
    runCommand(['test:portable-contract'], repositoryRoot),
  )
  const live = await timedRun(() =>
    liveGate({ serverUrl, token: serverToken, now }),
  )
  const completedAt = now().toISOString()
  const gitAfter = collectGit()
  if (
    gitAfter.commit !== gitBefore.commit
    || gitAfter.clean !== gitBefore.clean
    || JSON.stringify(gitAfter.changes) !== JSON.stringify(gitBefore.changes)
  ) {
    throw new Error('Git state changed while the platform contract suite was running')
  }

  const receipt = createPlatformContractReceipt({
    platform,
    arch,
    git: gitAfter,
    startedAt,
    completedAt,
    preflightDurationMs: preflight.durationMs,
    suiteDurationMs: suite.durationMs,
    liveServer: live.value,
    liveServerDurationMs: live.durationMs,
  })
  verifyPlatformContractReceipt(receipt, {
    expectedGit: gitAfter,
    requireClean: !allowDirty,
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  const temporaryPath = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.tmp`,
  )
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`)
  renameSync(temporaryPath, outputPath)
  return receipt
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args)
  const receipt = await runPlatformContract(options)
  process.stdout.write(
    `Platform contract receipt written: ${options.outputPath} (${receipt.platform.id})\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

export { PREFLIGHT_COMMAND, PORTABLE_CONTRACT_COMMAND }
