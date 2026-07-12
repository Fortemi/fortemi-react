#!/usr/bin/env node
import {
  fetchAndValidateFortemiCompatibility,
  formatFortemiCompatibilitySummary,
} from '../dist/index.js'

function usage() {
  return `Usage: verify-fortemi-compatibility [--base-url URL] [--json]

Validates a local Fortemi /api/v1/system/compatibility response using @fortemi/core.

Environment:
  FORTEMI_COMPATIBILITY_BASE_URL   Base URL or full compatibility endpoint URL
  HOTM_FORTEMI_BASE_URL            HotM-compatible fallback base URL

This is local compatibility evidence only. It is not hosted/mobile production proof.`
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: process.env.FORTEMI_COMPATIBILITY_BASE_URL || process.env.HOTM_FORTEMI_BASE_URL || 'http://localhost:3000',
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--json') {
      parsed.json = true
      continue
    }
    if (arg === '--base-url') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('--base-url requires a value')
      }
      parsed.baseUrl = value
      index += 1
      continue
    }
    if (arg.startsWith('--base-url=')) {
      parsed.baseUrl = arg.slice('--base-url='.length)
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }

  return parsed
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await fetchAndValidateFortemiCompatibility({ baseUrl: args.baseUrl })

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else if (result.ok && result.response) {
    console.log(`Fortemi compatibility check passed: ${result.url}`)
    console.log(formatFortemiCompatibilitySummary(result.response))
    for (const warning of result.warnings) {
      console.warn(`WARN: ${warning}`)
    }
  } else {
    console.error(`Fortemi compatibility check failed: ${result.url}`)
    for (const error of result.errors) {
      console.error(`FAIL: ${error}`)
    }
    for (const warning of result.warnings) {
      console.error(`WARN: ${warning}`)
    }
  }

  process.exit(result.ok ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
