#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const DEFAULT_ENDPOINT = '/api/v1/backup/knowledge-shard'

function usage() {
  return [
    'Usage:',
    '  pnpm --filter @fortemi/core shard:refresh-golden -- --server http://localhost:8080 --version 2026.2.9',
    '  pnpm --filter @fortemi/core shard:refresh-golden -- --url http://localhost:8080/api/v1/backup/knowledge-shard --out src/__tests__/shard/fixtures/golden/server-2026.2.9.shard',
    '',
    'Options:',
    '  --server <origin>   Server origin; the script appends /api/v1/backup/knowledge-shard.',
    '  --url <url>         Full shard export URL. Overrides --server.',
    '  --version <value>   Pinned server version used in the default output filename.',
    '  --out <path>        Output .shard path.',
    '  --token <value>     Optional bearer token for authenticated servers.',
    '  --help             Show this help.',
  ].join('\n')
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      args[key] = value
      index += 1
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }
  return args
}

function endpointFromArgs(args) {
  if (args.url) return args.url
  if (!args.server) throw new Error('Provide --url or --server')
  return new URL(DEFAULT_ENDPOINT, args.server).toString()
}

function outputFromArgs(args) {
  if (args.out) return resolve(args.out)
  if (!args.version) throw new Error('Provide --out or --version')
  return resolve('src/__tests__/shard/fixtures/golden', `server-${args.version}.shard`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const url = endpointFromArgs(args)
  const out = outputFromArgs(args)
  const headers = args.token ? { Authorization: `Bearer ${args.token}` } : undefined
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0) throw new Error(`GET ${url} returned an empty body`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, bytes)

  const receipt = {
    fixture: basename(out),
    source_url: url,
    pinned_version: args.version ?? null,
    fetched_at: new Date().toISOString(),
    bytes: bytes.byteLength,
    sha256,
  }
  await writeFile(`${out}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`wrote ${out}`)
  console.log(`sha256 ${sha256}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error('')
  console.error(usage())
  process.exit(1)
})
