#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  REPOSITORY_ROOT,
  collectGitIdentity,
  verifyPlatformContractReceipt,
} from './platform-contract-receipt.mjs'

function parseArgs(args) {
  let receiptPath
  let allowDirty = false
  for (const argument of args) {
    if (argument === '--allow-dirty') {
      allowDirty = true
    } else if (!receiptPath) {
      receiptPath = argument
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (!receiptPath) {
    throw new Error('Usage: pnpm verify:platform-contract-receipt <receipt.json>')
  }
  return { receiptPath: resolve(process.cwd(), receiptPath), allowDirty }
}

function runAuthorityDriftVerifier() {
  const result = spawnSync(
    'pnpm',
    ['--filter', '@fortemi/core', 'verify:knowledge-shard-contract'],
    { cwd: REPOSITORY_ROOT, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error('Vendored Fortemi authority verification failed')
  }
}

export function main(args = process.argv.slice(2)) {
  const { receiptPath, allowDirty } = parseArgs(args)
  runAuthorityDriftVerifier()
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  verifyPlatformContractReceipt(receipt, {
    expectedGit: collectGitIdentity(),
    requireClean: !allowDirty,
  })
  process.stdout.write(`Platform contract receipt verified: ${receiptPath}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
